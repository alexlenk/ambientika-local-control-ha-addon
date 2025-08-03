export class DeviceBroadcastStatus {
    serialNumber: string | undefined;
    zoneIndex: number;
    fanMode: string;
    fanStatus: string;


    constructor(serialNumber: string | undefined, zoneIndex: number, fanMode: string, fanStatus: string) {
        this.serialNumber = serialNumber;
        this.zoneIndex = zoneIndex;
        this.fanMode = fanMode;
        this.fanStatus = fanStatus;
    }
}
