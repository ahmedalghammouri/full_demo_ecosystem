// Back-compat shim — the client is now transport-agnostic (TCP / RTU / RTU_TCP).
// Existing imports of `ModbusTcpClient` keep working.
export { ModbusClient, ModbusClient as ModbusTcpClient } from './modbus-client';
