'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Radio, Search, Pause, Play, Trash2, Send, Wifi, WifiOff,
  ChevronRight, ChevronDown, Copy, Activity, Gauge, ListTree, X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useWebSocket } from '@/hooks/use-websocket';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

interface MqttMessage {
  topic: string;
  payload: unknown;
  quality?: string;
  receivedAt: string;
}

const MAX_FEED = 1000;

/** Split `industry360/<factory>/<seg>/<leaf>` into a readable leaf + muted parent path. */
function splitTopic(topic: string) {
  const parts = topic.split('/');
  const leaf = parts[parts.length - 1] ?? topic;
  const parent = parts.slice(0, -1).join('/');
  return { leaf, parent };
}

function prettyPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'object') { try { return JSON.stringify(payload, null, 2); } catch { return String(payload); } }
  return String(payload);
}

const QUALITY_CLS: Record<string, string> = {
  GOOD: 'text-green-400 bg-green-500/10 border-green-500/30',
  BAD: 'text-red-400 bg-red-500/10 border-red-500/30',
  UNCERTAIN: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
};

export function MqttClientView() {
  const { t } = useTranslation(['iot', 'common']);
  const { isConnected, subscribe } = useWebSocket();
  const { toast } = useToast();
  const [feed, setFeed] = useState<MqttMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pubTopic, setPubTopic] = useState('');
  const [pubPayload, setPubPayload] = useState('');
  const [rate, setRate] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const recvCountRef = useRef(0);

  // Seed from the server-side ring buffer so the feed isn't empty on load.
  const { data: initial } = useQuery({
    queryKey: ['iot', 'mqtt', 'messages'],
    queryFn: () => api.get<MqttMessage[]>('/iot/mqtt/messages', { params: { limit: 300 } }),
    staleTime: 10_000,
  });
  const { data: topicsData } = useQuery({
    queryKey: ['iot', 'mqtt', 'topics'],
    queryFn: () => api.get<{ topics: string[]; stats: any }>('/iot/mqtt/topics'),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (initial && Array.isArray(initial) && feed.length === 0) setFeed(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Live stream.
  useEffect(() => {
    const off = subscribe('mqtt:message', (raw: any) => {
      recvCountRef.current += 1;
      if (pausedRef.current) return;
      setFeed((prev) => [raw as MqttMessage, ...prev].slice(0, MAX_FEED));
    });
    return off;
  }, [subscribe]);

  // Messages/second meter.
  useEffect(() => {
    const id = setInterval(() => { setRate(recvCountRef.current); recvCountRef.current = 0; }, 1000);
    return () => clearInterval(id);
  }, []);

  const topics: string[] = (topicsData as any)?.topics ?? [];
  const stats = (topicsData as any)?.stats;

  const topicCounts = useMemo(() => {
    const map = new Map<string, number>();
    feed.forEach((m) => map.set(m.topic, (map.get(m.topic) ?? 0) + 1));
    return map;
  }, [feed]);

  const visible = useMemo(() => {
    let rows = feed;
    if (selectedTopic) rows = rows.filter((m) => m.topic === selectedTopic);
    if (filter) {
      const f = filter.toLowerCase();
      rows = rows.filter((m) => m.topic.toLowerCase().includes(f) || JSON.stringify(m.payload).toLowerCase().includes(f));
    }
    return rows;
  }, [feed, filter, selectedTopic]);

  const copy = (text: string) => { navigator.clipboard?.writeText(text); toast({ title: 'Copied to clipboard' }); };

  const publish = async () => {
    if (!pubTopic.trim()) return;
    let payload: unknown = pubPayload;
    try { payload = JSON.parse(pubPayload); } catch { /* send as raw string */ }
    try {
      await api.post('/iot/mqtt/publish', { topic: pubTopic.trim(), payload });
      toast({ title: 'Published', description: pubTopic });
      setPubPayload('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Publish failed', description: e?.response?.data?.message });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Radio size={18} className="text-primary" /> {t('headers.mqtt.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.mqtt.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 text-[10px]"><Gauge size={11} className="text-blue-400" /> {rate}/s</Badge>
          {stats && <Badge variant="outline" className="gap-1.5 text-[10px]"><ListTree size={11} /> {stats.topics} topics</Badge>}
          <Badge variant="outline" className="gap-1.5 text-[10px]"><Activity size={11} /> {feed.length} buffered</Badge>
          <Badge variant="outline" className={cn('gap-1.5', isConnected ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30')}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />} {isConnected ? 'Live' : 'Offline'}
          </Badge>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-[280px_1fr] gap-0">
        {/* Topic tree */}
        <div className="border-r border-border/50 overflow-y-auto p-3 space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1 flex items-center gap-1.5"><ListTree size={12} /> Topics ({topics.length})</div>
          <button
            onClick={() => setSelectedTopic(null)}
            className={cn('w-full text-left px-2 py-1.5 rounded-md text-xs', !selectedTopic ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted/40')}
          >
            All topics
          </button>
          {topics.map((t) => {
            const { leaf, parent } = splitTopic(t);
            return (
              <button
                key={t}
                onClick={() => setSelectedTopic(t)}
                className={cn('w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between gap-1.5', selectedTopic === t ? 'bg-primary/15' : 'hover:bg-muted/40')}
                title={t}
              >
                <span className="min-w-0">
                  <span className={cn('block text-[11px] font-mono font-medium truncate', selectedTopic === t ? 'text-primary' : 'text-foreground')}>{leaf}</span>
                  <span className="block text-[9px] text-muted-foreground truncate">{parent}</span>
                </span>
                {topicCounts.get(t) ? <span className="text-[9px] px-1 rounded bg-foreground/10 shrink-0">{topicCounts.get(t)}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Feed + publisher */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Filter topic or payload…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 pl-7 text-xs" />
            </div>
            <Button size="sm" variant={paused ? 'default' : 'outline'} className="h-8 text-xs gap-1.5" onClick={() => setPaused((p) => !p)}>
              {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setFeed([])}>
              <Trash2 size={12} /> Clear
            </Button>
            {selectedTopic && (
              <Badge variant="secondary" className="text-[10px] gap-1 max-w-[200px]">
                <span className="truncate">{splitTopic(selectedTopic).leaf}</span>
                <button onClick={() => setSelectedTopic(null)}><X size={10} /></button>
              </Badge>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">{visible.length} shown{paused ? ' · paused' : ''}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm">
                <Radio size={24} className="mx-auto mb-2 opacity-40" />
                {paused ? 'Paused — press Resume to stream live.' : 'Waiting for MQTT traffic…'}
              </div>
            ) : visible.map((m, i) => {
              const key = `${m.topic}|${m.receivedAt}|${i}`;
              const isOpen = expanded === key;
              const { leaf, parent } = splitTopic(m.topic);
              const obj = m.payload && typeof m.payload === 'object' ? (m.payload as any) : null;
              const oneLine = typeof m.payload === 'object' ? JSON.stringify(m.payload) : String(m.payload ?? '');
              const q = obj?.quality as string | undefined;
              return (
                <div key={key} className="border-b border-border/20 hover:bg-muted/10">
                  <div className="px-4 py-1.5 flex items-start gap-2 cursor-pointer" onClick={() => setExpanded(isOpen ? null : key)}>
                    {isOpen ? <ChevronDown size={12} className="mt-1 text-muted-foreground shrink-0" /> : <ChevronRight size={12} className="mt-1 text-muted-foreground shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-medium text-primary truncate max-w-[260px]" title={m.topic}>{leaf}</span>
                        <span className="font-mono text-[9px] text-muted-foreground truncate max-w-[200px] hidden md:inline">{parent}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">{new Date(m.receivedAt).toLocaleTimeString()}</span>
                      </div>
                      {!isOpen && (
                        <div className="flex items-center gap-2 mt-0.5">
                          {obj && 'value' in obj && (
                            <span className="text-xs font-mono font-semibold tabular-nums">{String(obj.value)}</span>
                          )}
                          {q && <span className={cn('text-[9px] px-1 rounded border', QUALITY_CLS[q] ?? 'text-muted-foreground border-border')}>{q}</span>}
                          <span className="text-[10px] font-mono text-muted-foreground truncate">{obj && 'value' in obj ? '' : oneLine}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-2.5 pl-8">
                      <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 relative">
                        <button className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-foreground" title="Copy payload" onClick={(e) => { e.stopPropagation(); copy(prettyPayload(m.payload)); }}>
                          <Copy size={12} />
                        </button>
                        <div className="text-[10px] text-muted-foreground font-mono mb-1.5 break-all">{m.topic}</div>
                        <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-foreground/90">{prettyPayload(m.payload) || '(empty)'}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Publisher */}
          <div className="border-t border-border/40 p-3 flex items-end gap-2">
            <div className="flex-1 grid grid-cols-[1fr_2fr] gap-2">
              <Input placeholder="Topic (industry360/…)" value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} className="h-8 text-xs font-mono" />
              <Input placeholder='Payload — JSON e.g. {"value":1,"quality":"GOOD"} or plain text' value={pubPayload} onChange={(e) => setPubPayload(e.target.value)} className="h-8 text-xs font-mono" onKeyDown={(e) => { if (e.key === 'Enter') publish(); }} />
            </div>
            <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!pubTopic.trim()} onClick={publish}>
              <Send size={12} /> Publish
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
