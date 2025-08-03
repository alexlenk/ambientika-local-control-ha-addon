export class DeviceInfo {
    serialNumber: string;
    radioFwVersion: string;
    microFwVersion: string;
    radioAtCommandsFwVersion: string;


    constructor(serialNumber: string, radioFwVersion: string, microFwVersion: string, radioAtCommandsFwVersion: string) {
        this.serialNumber = serialNumber;
        this.radioFwVersion = radioFwVersion;
        this.microFwVersion = microFwVersion;
        this.radioAtCommandsFwVersion = radioAtCommandsFwVersion;
    }
}
