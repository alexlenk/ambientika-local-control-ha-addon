export class DeviceBroadcastStatus {
    serialNumber: string | undefined;
    allSerialNumbers: string[];
    zoneIndex: number;
    fanMode: string;
    fanStatus: string;

    constructor(serialNumber: string | undefined, allSerialNumbers: string[], zoneIndex: number, fanMode: string, fanStatus: string) {
        this.serialNumber = serialNumber;
        this.allSerialNumbers = allSerialNumbers;
        this.zoneIndex = zoneIndex;
        this.fanMode = fanMode;
        this.fanStatus = fanStatus;
    }
}
