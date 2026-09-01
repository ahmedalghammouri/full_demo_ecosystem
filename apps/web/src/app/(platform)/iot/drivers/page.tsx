import type { Metadata } from 'next';
import { IotDriversView } from '@/features/iot/iot-drivers-view';
export const metadata: Metadata = { title: 'IoT Drivers | i360' };
export default function DriversPage() { return <IotDriversView />; }
