export class DeviceWeatherUpdate {
    serialNumber: string;
    temperature: number;
    humidity: number;
    airQuality: string;

    constructor(serialNumber: string, temperature: number, humidity: number, airQuality: string) {
        this.serialNumber = serialNumber;
        this.temperature = temperature;
        this.humidity = humidity;
        this.airQuality = airQuality;
    }
}
