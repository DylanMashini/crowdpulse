// Reads a Bluetooth chest strap through the standard GATT Heart Rate service (0x180D) in Chrome.
// TypeScript's DOM library has no Web Bluetooth types, so the few members used are declared here.

interface GattCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<GattCharacteristic>;
}
interface GattService {
  getCharacteristic(name: string): Promise<GattCharacteristic>;
}
interface GattServer {
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(name: string): Promise<GattService>;
}
interface BluetoothDevice extends EventTarget {
  name?: string;
  gatt?: GattServer;
}
interface Bluetooth {
  requestDevice(options: { filters: Array<{ services: string[] }> }): Promise<BluetoothDevice>;
}

export interface StrapSample {
  /** Browser clock when the notification arrived, in ms. */
  receivedAt: number;
  /** bpm. Null when the strap reports no skin contact or sends zero. */
  heartRate: number | null;
  /** Beat-to-beat intervals carried by this notification, in ms. Empty when the strap sends none. */
  rrIntervalsMs: number[];
}

export interface StrapConnection {
  name: string;
  disconnect: () => void;
}

function bluetooth(): Bluetooth | null {
  const candidate = (globalThis.navigator as (Navigator & { bluetooth?: Bluetooth }) | undefined)?.bluetooth;
  return candidate ?? null;
}

export function strapSupported(): boolean {
  return bluetooth() !== null;
}

/**
 * Decodes one Heart Rate Measurement characteristic value (Bluetooth SIG, 0x2A37).
 * Byte 0 is flags: bit 0 picks an 8 or 16 bit rate, bits 1 and 2 are sensor contact, bit 3 says
 * an energy field follows, bit 4 says RR intervals follow, each in units of 1/1024 s.
 */
export function parseHeartRateMeasurement(view: DataView): Omit<StrapSample, 'receivedAt'> {
  const flags = view.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  const contactKnown = (flags & 0x04) !== 0;
  const contact = (flags & 0x02) !== 0;
  let offset = 1;
  const rate = wide ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += wide ? 2 : 1;
  if (flags & 0x08) offset += 2;

  const rrIntervalsMs: number[] = [];
  if (flags & 0x10) {
    for (; offset + 1 < view.byteLength; offset += 2) {
      const interval = (view.getUint16(offset, true) / 1024) * 1000;
      if (interval > 0) rrIntervalsMs.push(Math.round(interval * 10) / 10);
    }
  }
  const usable = rate > 0 && (!contactKnown || contact);
  return { heartRate: usable ? rate : null, rrIntervalsMs };
}

/**
 * Opens Chrome's device chooser and subscribes to the strap. Must be called from a click.
 * Rejects with a DOMException named NotFoundError when the chooser is closed without a choice.
 */
export async function connectStrap(onSample: (sample: StrapSample) => void, onDisconnect: () => void): Promise<StrapConnection> {
  const api = bluetooth();
  if (!api) throw new Error('Web Bluetooth is not available in this browser');
  const device = await api.requestDevice({ filters: [{ services: ['heart_rate'] }] });
  if (!device.gatt) throw new Error('The chosen device does not offer a Bluetooth connection');

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('heart_rate');
  const characteristic = await service.getCharacteristic('heart_rate_measurement');
  characteristic.addEventListener('characteristicvaluechanged', () => {
    if (characteristic.value) onSample({ receivedAt: Date.now(), ...parseHeartRateMeasurement(characteristic.value) });
  });
  device.addEventListener('gattserverdisconnected', onDisconnect);
  await characteristic.startNotifications();

  return {
    name: device.name || 'Heart rate strap',
    disconnect: () => {
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      server.disconnect();
    },
  };
}
