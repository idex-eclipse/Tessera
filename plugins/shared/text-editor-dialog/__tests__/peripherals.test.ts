import { describe, expect, it, vi } from 'vitest';

import {
  classifyError,
  isValidCanInterface,
  loadDevices,
  type RequestFn,
} from '../peripherals';

const fake = (result: unknown): RequestFn => vi.fn(async () => result);

describe('loadDevices: serial', () => {
  const resp = {
    serial_devices: [
      {
        device_type: 'hardware_uart',
        device_path: '/dev/ttyS0',
        device_name: 'ttyS0',
        driver_name: 'serial8250',
      },
      {
        device_type: 'usb',
        device_path: '/dev/ttyACM0',
        device_name: 'ttyACM0',
        driver_name: 'cdc_acm',
        path_by_id: '/dev/serial/by-id/usb-Klipper_stm32-if00',
        path_by_hardware: '/dev/serial/by-path/pci-0:1.2',
        usb_location: '1-1.2',
      },
    ],
  };

  it('запрашивает нужный метод и ставит устройства с by-id первыми', async () => {
    const request = fake(resp);
    const cards = await loadDevices(request, 'serial');
    expect(request).toHaveBeenCalledWith('machine.peripherals.serial');
    expect(cards.map((c) => c.title)).toEqual(['/dev/ttyACM0', '/dev/ttyS0']);
  });

  it('пути и идентификаторы помечены copyable и идут первыми', async () => {
    const [card] = await loadDevices(fake(resp), 'serial');
    const copyable = card!.fields.filter((f) => f.copyable).map((f) => f.key);
    expect(copyable).toEqual(['device_path', 'path_by_id', 'path_by_hardware', 'usb_location']);
    expect(card!.fields.slice(0, copyable.length).every((f) => f.copyable)).toBe(true);
    // остальные поля тоже показываются
    expect(card!.fields.find((f) => f.key === 'driver_name')?.value).toBe('cdc_acm');
  });
});

describe('loadDevices: usb', () => {
  it('добавляет vendor_product и использует product как заголовок', async () => {
    const [card] = await loadDevices(
      fake({
        usb_devices: [
          { vendor_id: '1d50', product_id: '614e', manufacturer: 'Klipper', product: 'stm32', serial: 'ABC' },
        ],
      }),
      'usb',
    );
    expect(card!.title).toBe('stm32');
    expect(card!.subtitle).toBe('Klipper · 1d50:614e');
    const vp = card!.fields.find((f) => f.key === 'vendor_product');
    expect(vp).toEqual({ key: 'vendor_product', value: '1d50:614e', copyable: true });
  });
});

describe('loadDevices: video', () => {
  it('объединяет v4l2 и libcamera, сложные поля сериализует', async () => {
    const cards = await loadDevices(
      fake({
        v4l2_devices: [
          {
            camera_name: 'Cam',
            device_path: '/dev/video0',
            driver_name: 'uvcvideo',
            modes: [{ format: 'MJPG', resolutions: ['640x480'] }],
            capabilities: ['VIDEO_CAPTURE', 'STREAMING'],
          },
        ],
        libcamera_devices: [{ libcamera_id: 'cam-1', model: 'imx708' }],
      }),
      'video',
    );
    expect(cards.map((c) => c.title)).toEqual(['Cam', 'imx708']);
    const modes = cards[0]!.fields.find((f) => f.key === 'modes');
    expect(modes?.value).toContain('MJPG');
    expect(modes?.copyable).toBe(false);
    expect(cards[0]!.fields.find((f) => f.key === 'capabilities')?.value).toBe(
      'VIDEO_CAPTURE, STREAMING',
    );
    expect(cards[1]!.fields[0]).toEqual({ key: 'libcamera_id', value: 'cam-1', copyable: true });
  });
});

describe('loadDevices: canbus', () => {
  it('передаёт interface, по умолчанию can0', async () => {
    const request = fake({ can_uuids: [{ uuid: 'deadbeef0001', application: 'Klipper' }] });
    const cards = await loadDevices(request, 'canbus');
    expect(request).toHaveBeenCalledWith('machine.peripherals.canbus', { interface: 'can0' });
    expect(cards[0]!.title).toBe('deadbeef0001');
    expect(cards[0]!.subtitle).toBe('Klipper');
    expect(cards[0]!.fields[0]).toEqual({ key: 'uuid', value: 'deadbeef0001', copyable: true });

    await loadDevices(request, 'canbus', { canInterface: ' can1 ' });
    expect(request).toHaveBeenLastCalledWith('machine.peripherals.canbus', { interface: 'can1' });
  });

  it('не отправляет запрос с некорректным именем интерфейса', async () => {
    const request = fake({});
    await expect(loadDevices(request, 'canbus', { canInterface: 'can0; rm' })).rejects.toThrow(
      /Invalid CAN interface/,
    );
    expect(request).not.toHaveBeenCalled();
    expect(isValidCanInterface('can0')).toBe(true);
    expect(isValidCanInterface('can 0')).toBe(false);
  });
});

describe('устойчивость к странному ответу', () => {
  it('пустой/неожиданный ответ даёт пустой список, а не исключение', async () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { serial_devices: 'nope' }, { serial_devices: [1, null, 'a'] }]) {
      await expect(loadDevices(fake(bad), 'serial')).resolves.toEqual([]);
    }
  });

  it('неизвестные поля тоже выводятся, null/пустые пропускаются', async () => {
    const [card] = await loadDevices(
      fake({ serial_devices: [{ device_path: '/dev/x', mystery: 5, flag: true, nothing: null, empty: '' }] }),
      'serial',
    );
    const keys = card!.fields.map((f) => f.key);
    expect(keys).toEqual(['device_path', 'mystery', 'flag']);
    expect(card!.fields.find((f) => f.key === 'mystery')?.value).toBe('5');
  });

  it('ошибка запроса пробрасывается вызывающему', async () => {
    const request: RequestFn = async () => {
      throw new Error('boom');
    };
    await expect(loadDevices(request, 'usb')).rejects.toThrow('boom');
  });
});

describe('classifyError', () => {
  it('раскладывает ошибки по состояниям', () => {
    expect(classifyError(new Error('Method not found')).status).toBe('unsupported');
    expect(classifyError(new Error('Moonraker connection is not open')).status).toBe('offline');
    expect(classifyError(new Error('Moonraker connection closed')).status).toBe('offline');
    expect(classifyError(new Error('Something else'))).toEqual({
      status: 'error',
      message: 'Something else',
    });
    expect(classifyError('plain string').message).toBe('plain string');
  });
});
