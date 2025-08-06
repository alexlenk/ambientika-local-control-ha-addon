import {Logger} from 'winston';
import {DeviceBroadcastStatus} from '../models/device-broadcast-status.model';
import {EventService} from './event.service';
import {AppEvents} from '../models/enum/app-events.enum';
import {DeviceSetup} from '../models/device-setup.model';

export class DeviceMetadataService {
    private readonly deviceHouseIds: Map<string, number> = new Map<string, number>();
    private readonly deviceZoneIds: Map<string, number> = new Map<string, number>();

    constructor(private log: Logger, private eventService: EventService) {
        this.initEventListener();
    }

    private initEventListener(): void {
        this.eventService.on(AppEvents.DEVICE_BROADCAST_STATUS_RECEIVED,
            (deviceBroadcastStatus: DeviceBroadcastStatus) => {
                // Track house ID and zone ID from UDP broadcasts
                if (deviceBroadcastStatus.serialNumber && deviceBroadcastStatus.houseId !== undefined && deviceBroadcastStatus.houseId > 0) {
                    this.deviceHouseIds.set(deviceBroadcastStatus.serialNumber, deviceBroadcastStatus.houseId);
                    this.deviceZoneIds.set(deviceBroadcastStatus.serialNumber, deviceBroadcastStatus.zoneIndex);
                    this.log.info(`Tracked device metadata from broadcast ${deviceBroadcastStatus.serialNumber}: houseId=${deviceBroadcastStatus.houseId}, zoneId=${deviceBroadcastStatus.zoneIndex}`);
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
}