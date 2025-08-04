import {Adapter, createBluetooth, Device, GattServer, GattService} from 'node-ble';

const {bluetooth, destroy} = createBluetooth()

const HOST_CHAR_PREFIX = 'H_';
const CLOUD_HOST = 'app.ambientika.eu:11000';
const SSID_CHAR_PREFIX = 'S_';
const SSID = 'Wifi SSID Name';
const PWD_CHAR_PREFIX = 'P_';
const PWD = 'wifiPassWord';
const MAC = 'AA:BB:CC:DD:EE:FF'

const start = async function () {
    const adapter: Adapter = await bluetooth.defaultAdapter()
    const discovering: boolean = await adapter.isDiscovering();
    if (!discovering)
        await adapter.startDiscovery()
    const device: Device = await adapter.waitDevice(MAC)
    await device.connect()
    const gattServer: GattServer = await device.gatt();
    const services: string[] = await gattServer.services();
    const wifiServiceUUID = services.find(service => /^0000a002-.*/.test(service));
    if (wifiServiceUUID) {
        const wifiService: GattService = await gattServer.getPrimaryService(wifiServiceUUID);
        if (wifiService) {
            const characteristics = await wifiService.characteristics();
            const wifiCharacteristics = characteristics.find(characteristic => /^0000c302-.*/.test(characteristic));
            if (wifiCharacteristics) {
                const wifiServiceCharacteristics = await wifiService.getCharacteristic(wifiCharacteristics);
                if (wifiServiceCharacteristics) {
                    const host = HOST_CHAR_PREFIX + CLOUD_HOST;
                    try {
                        await wifiServiceCharacteristics.writeValue(Buffer.from(host));
                    } catch (err: any) {
                        if (err.type === 'org.bluez.Error.InvalidArguments') {
                            console.log('Ignore InvalidArguments');
                        } else {
                            console.error(err);
                        }
                    }
                    const wifi = SSID_CHAR_PREFIX + SSID;
                    try {
                        await wifiServiceCharacteristics.writeValue(Buffer.from(wifi));
                    } catch (err: any) {
                        if (err.type === 'org.bluez.Error.InvalidArguments') {
                            console.log('Ignore InvalidArguments');
                        } else {
                            console.error(err);
                        }
                    }
                    const wifiPw = PWD_CHAR_PREFIX + PWD;
                    try {
                        await wifiServiceCharacteristics.writeValue(Buffer.from(wifiPw));
                    } catch (err: any) {
                        if (err.type === 'org.bluez.Error.InvalidArguments') {
                            console.log('Ignore InvalidArguments');
                        } else {
                            console.error(err);
                        }
                    }
                    await device.disconnect();
                    destroy();
                }
            } else {
                console.log('Could not obtain wifi characteristics UUID');
                await device.disconnect();
                destroy();
            }
        } else {
            console.log('Could not obtain wifi service UUID');
            await device.disconnect();
            destroy();
        }
    } else {
        await device.disconnect();
        destroy();
    }
}

start();

