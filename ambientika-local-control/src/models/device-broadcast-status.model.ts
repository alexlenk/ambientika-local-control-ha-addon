export class DeviceBroadcastStatus {
    serialNumber: string | undefined;
    zoneIndex: number;
    fanMode: string;
    fanStatus: string;
    houseId: number | undefined;


    constructor(serialNumber: string | undefined, zoneIndex: number, fanMode: string, fanStatus: string, houseId?: number) {
        this.serialNumber = serialNumber;
        this.zoneIndex = zoneIndex;
        this.fanMode = fanMode;
        this.fanStatus = fanStatus;
        this.houseId = houseId;
    }
}
