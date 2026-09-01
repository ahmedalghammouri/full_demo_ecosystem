import type { Metadata } from 'next';
import { MqttClientView } from '@/features/iot/mqtt-client-view';

export const metadata: Metadata = { title: 'MQTT Client | i360' };

export default function MqttClientPage() {
  return <MqttClientView />;
}
