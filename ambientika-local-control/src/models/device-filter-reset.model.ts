export class DeviceFilterReset {
    serialNumber: string;
    filterReset: number;

    constructor(serialNumber: string, filterReset:number){
        this.serialNumber = serialNumber;
        this.filterReset = filterReset;
    }
}
