import {Logger} from 'winston';
import {DeviceBroadcastStatus} from '../models/device-broadcast-status.model';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {DeviceSetup} from '../models/device-setup.model';
import {Device} from '../models/device.model';

export class DeviceMetadataService {
    private readonly deviceHouseIds: Map<string, number> = new Map<string, number>();
    private readonly deviceZoneIds: Map<string, number> = new Map<string, number>();
    
    // Track house IDs from UDP broadcasts by IP:port (for multi-house networks)
    private readonly udpHouseIds: Map<string, { houseId: number, lastSeen: number }> = new Map<string, { houseId: number, lastSeen: number }>();
    
    // Track IP address to serial number mappings from TCP connections
    private readonly ipToSerialMapping: Map<string, string> = new Map<string, string>();

    constructor(private log: Logger, private eventService: EventService) {
        this.initEventListener();
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED,
            (deviceBroadcastStatus: DeviceBroadcastStatus, sourceAddress?: string) => {
                // Track house ID and zone ID from UDP broadcasts
                if (deviceBroadcastStatus.serialNumber && deviceBroadcastStatus.houseId !== undefined && deviceBroadcastStatus.houseId > 0) {
                    this.deviceHouseIds.set(deviceBroadcastStatus.serialNumber, deviceBroadcastStatus.houseId);
                    this.deviceZoneIds.set(deviceBroadcastStatus.serialNumber, deviceBroadcastStatus.zoneIndex);
                    this.log.info(`Tracked device metadata from broadcast ${deviceBroadcastStatus.serialNumber}: houseId=${deviceBroadcastStatus.houseId}, zoneId=${deviceBroadcastStatus.zoneIndex}`);
                }
                
                // Track house IDs from UDP broadcasts by IP:port for correlation with TCP devices
                if (sourceAddress && deviceBroadcastStatus.houseId !== undefined && deviceBroadcastStatus.houseId > 0) {
                    this.udpHouseIds.set(sourceAddress, {
                        houseId: deviceBroadcastStatus.houseId,
                        lastSeen: Date.now()
                    });
                    this.log.debug(`Tracked UDP house ID from ${sourceAddress}: houseId=${deviceBroadcastStatus.houseId}`);
                }
            });

        this.eventService.on(AppEvents.DEVICE_SETUP_UPDATE,
            (deviceSetup: DeviceSetup) => {
                // Track house ID and zone ID from device setup messages (both master and slave devices)
                if (deviceSetup.serialNumber && deviceSetup.houseId > 0) {
                    this.deviceHouseIds.set(deviceSetup.serialNumber, deviceSetup.houseId);
                    this.deviceZoneIds.set(deviceSetup.serialNumber, deviceSetup.zoneIndex);
                    this.log.info(`Tracked device metadata from setup ${deviceSetup.serialNumber}: houseId=${deviceSetup.houseId}, zoneId=${deviceSetup.zoneIndex}, role=${deviceSetup.deviceRole}`);
                }
            });

        this.eventService.on(AppEvents.DEVICE_STATUS_UPDATE_RECEIVED,
            (device: Device) => {
                // Correlate TCP device connections with UDP house IDs
                this.correlateDeviceWithUdpHouseId(device);
            });
    }

    getDeviceHouseId(serialNumber: string): number {
        return this.deviceHouseIds.get(serialNumber) || 0;
    }

    getDeviceZoneId(serialNumber: string): number {
        return this.deviceZoneIds.get(serialNumber) || 0;
    }

    // For devices that don't have UDP broadcasts, try to infer from house systems
    inferHouseId(serialNumber: string): number {
        // If we have any tracked devices, use the most common house ID
        const houseIds = Array.from(this.deviceHouseIds.values());
        if (houseIds.length > 0) {
            // Return the most frequently occurring house ID
            const counts = houseIds.reduce((acc, id) => {
                acc[id] = (acc[id] || 0) + 1;
                return acc;
            }, {} as Record<number, number>);
            
            return parseInt(Object.keys(counts).reduce((a, b) => counts[parseInt(a)] > counts[parseInt(b)] ? a : b));
        }
        return 0;
    }

    private correlateDeviceWithUdpHouseId(device: Device): void {
        // Skip if we already have house ID for this device
        if (this.deviceHouseIds.has(device.serialNumber)) {
            return;
        }

        // Store IP to serial mapping for future reference
        this.ipToSerialMapping.set(device.remoteAddress, device.serialNumber);

        // Try to find house ID from recent UDP broadcasts from the same IP
        const deviceBaseIp = device.remoteAddress.split(':')[0]; // Extract IP without port
        const currentTime = Date.now();
        const maxAge = 30000; // 30 seconds - UDP broadcasts are frequent

        // Look for UDP broadcasts from the same IP (any port)
        for (const [udpSource, houseIdInfo] of this.udpHouseIds) {
            const udpIp = udpSource.split(':')[0];
            
            // Check if IP matches and broadcast is recent
            if (udpIp === deviceBaseIp && (currentTime - houseIdInfo.lastSeen) <= maxAge) {
                this.deviceHouseIds.set(device.serialNumber, houseIdInfo.houseId);
                this.log.info(`Correlated TCP device ${device.serialNumber} at ${device.remoteAddress} with UDP house ID ${houseIdInfo.houseId} from ${udpSource}`);
                break;
            }
        }

        // Clean up old UDP entries (older than 5 minutes)
        for (const [udpSource, houseIdInfo] of this.udpHouseIds) {
            if ((currentTime - houseIdInfo.lastSeen) > 300000) {
                this.udpHouseIds.delete(udpSource);
            }
        }
    }
}