export class DeviceSetup {
    serialNumber: string;
    houseId: number;
    zoneIndex: number;
    deviceRole: string;


    constructor(serialNumber: string, deviceRole: string, zoneIndex: number, houseId: number) {
        this.serialNumber = serialNumber;
        this.houseId = houseId;
        this.zoneIndex = zoneIndex;
        this.deviceRole = deviceRole;
    }
}
