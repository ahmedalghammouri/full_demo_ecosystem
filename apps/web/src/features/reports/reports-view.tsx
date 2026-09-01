'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileBarChart, Download, Calendar, TrendingUp,
  Activity, Shield, Wrench, BarChart3, Gauge, FileText,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/services/api.client';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  module: string;
  icon: string;
}

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Factory:      Activity,
  ShieldCheck:  Shield,
  Wrench:       Wrench,
  Gauge:        Gauge,
  BarChart3:    BarChart3,
  TrendingUp:   TrendingUp,
  FileBarChart: FileBarChart,
};

const MODULE_COLORS: Record<string, { color: string; bg: string }> = {
  production:  { color: 'text-brand-400',  bg: 'bg-brand-500/20'  },
  quality:     { color: 'text-purple-400', bg: 'bg-purple-500/20' },
  maintenance: { color: 'text-amber-400',  bg: 'bg-amber-500/20'  },
};

const categories = ['All', 'production', 'quality', 'maintenance'];

export function ReportsView() {
  const { t } = useTranslation('modules');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [generating, setGenerating] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'templates'],
    queryFn: () => api.get<ReportTemplate[]>('/reports'),
    staleTime: 60_000,
  });

  const templates: ReportTemplate[] = (data as any) ?? [];

  const filtered = templates.filter(r => selectedCategory === 'All' || r.module === selectedCategory);

  const handleGenerate = (reportId: string) => {
    setGenerating(reportId);
    setTimeout(() => setGenerating(null), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">{t('reports.overview.title')}
            <DashboardInfo id="analytics-reports" />
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('reports.overview.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Calendar className="w-4 h-4 mr-2" />
            {t('reports.list.schedule')}
          </Button>
          <Button size="sm">
            <FileBarChart className="w-4 h-4 mr-2" />
            {t('reports.list.customReport')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">{t('reports.list.tabTemplates')}</TabsTrigger>
          <TabsTrigger value="scheduled">{t('reports.list.tabScheduled')}</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {categories.map(cat => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedCategory(cat)}
                className="capitalize"
              >
                {cat === 'All' ? t('reports.list.catAll') : t(`reports.list.cat.${cat}`, { defaultValue: cat })}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-48 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((report, i) => {
                const Icon = ICON_MAP[report.icon] ?? FileText;
                const palette = MODULE_COLORS[report.module] ?? { color: 'text-muted-foreground', bg: 'bg-muted/20' };
                const isGenerating = generating === report.id;
                return (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="glass-card rounded-xl p-5 flex flex-col gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${palette.bg}`}>
                        <Icon className={`w-5 h-5 ${palette.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{report.name}</div>
                        <Badge variant="outline" className="text-[10px] mt-1 capitalize">{t(`reports.list.cat.${report.module}`, { defaultValue: report.module })}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{report.description}</p>
                    <div className="flex gap-2 mt-auto">
                      <Button size="sm" className="flex-1" onClick={() => handleGenerate(report.id)} disabled={isGenerating}>
                        {isGenerating ? t('reports.list.generating') : t('reports.list.generate')}
                      </Button>
                      <Button size="sm" variant="outline">
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="scheduled" className="mt-4">
          <div className="glass-card rounded-xl p-8 text-center text-muted-foreground">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <div className="font-medium">{t('reports.list.scheduledSoon')}</div>
            <div className="text-sm mt-1">{t('reports.list.scheduledSoonDesc')}</div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
