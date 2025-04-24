import { ILogObj, Logger } from "tslog";
import { Provider } from "nconf";
import { PerformanceData, PowerData, HeartRateData, CadenceData, EventData } from "../handler/DataHandler";

type UserData = {
    hrZones: number[][],
    pwrZones: number[][],
    weight: number,
    restHr: number,
    maxHr: number,
    ftp: number
}

type TimestampData = {
    timestamp: number,
    data: number
}

type PowerDataApp = PowerData & {
    powerZoneTick: number,
    cumulativePwr: number,
    lastPwrTime: number,
    elapsedPwrTime: number,
    cumulativeNp: number,
    cumulativeNpSize: number,
    normalizedPowerWindow: number,
    normalizedStartTime: number | undefined,
    normalizedPowerTick: number,
    normalizedPowerBuffer: TimestampData[]
}    

type HeartRateDataApp = HeartRateData & {
    heartRateZoneTick: number,
    cumulativeHr: number,
    lastHrTime: number,
    elapsedHrTime: number
}

type CadenceDataApp = CadenceData & {
    cumulativeCad: number,
    cumulativeCadSize: number
}

export default class PerformanceMetrics {
    // Logger property
    private logger: Logger<ILogObj>;
    // User data
    private user: UserData;
    // Power properties
    private power: PowerDataApp;
    // Heart rate properties
    private heartRate: HeartRateDataApp;
    // Cadence properties
    private cadence: CadenceDataApp;

    constructor(logger: Logger<ILogObj>, nconf: Provider) {
        this.logger = logger;

        const hrconfig = nconf.get('user.heartrate');
        const pwrconfig = nconf.get('user.power');
        const profileconfig = nconf.get('user.profile');
        const handlerconfig = nconf.get('handler.performance');

        this.user = {
            hrZones: convertHeartRateZones(hrconfig.rest, hrconfig.max, hrconfig.zones),
            pwrZones: convertPowerZones(pwrconfig.ftp, pwrconfig.zones),
            weight: profileconfig.weight,
            restHr: hrconfig.rest,
            maxHr: hrconfig.max,
            ftp: pwrconfig.ftp
        };

        this.power = newPowerData(handlerconfig.normalizedPowerWindow);

        this.heartRate = newHeartRateData();

        this.cadence = newCadenceData();
    }

    private accumulatePower(data: number, now: number) {
        // Store current power
        this.power.power = data;

        // Store power max
        if (this.power.powerMax < data) this.power.powerMax = data;

        // Compute power zone and time in zone
        const zone = getZoneIndex(data, this.user.pwrZones);
        if (zone !== this.power.powerZone) {
            this.power.powerZone = zone;
            this.power.powerZoneTime = 0;
            this.power.powerZoneTick = now;
        } else {
            this.power.powerZoneTime = Math.round((now - this.power.powerZoneTick) / 1000);
        }

        // Accumulate the total average
        const dt = (now - this.power.lastPwrTime) / 1000;
        if (this.power.lastPwrTime > 0 && dt > 0 && dt <= 5) {
            this.power.cumulativePwr += data * dt; // power * seconds
            this.power.elapsedPwrTime += dt;       // total seconds
        }
        this.power.lastPwrTime = now;

        // Add the new power data with a timestamp
        this.power.normalizedPowerBuffer.push({ timestamp: now, data: data });

        // Remove old data points outside the 30-second window
        this.power.normalizedPowerBuffer = this.power.normalizedPowerBuffer.filter((entry) => now - entry.timestamp <= this.power.normalizedPowerWindow);
        
        if (now - this.power.normalizedPowerTick >= 1000) {
            // Accumulate the normalized power based on a rolling 30s (normalizedPowerWindow) average sampled every 1s
            const movingAveragePower = calculateMovingAverage(this.power.normalizedPowerBuffer)
            this.power.cumulativeNp += Math.pow(movingAveragePower, 4);
            this.power.cumulativeNpSize++;    
            this.power.normalizedPowerTick = now;
        }
    }

    private accumulateHeartRate(data: number, now: number) {
        // Store current heart rate
        this.heartRate.heartRate = data;

        // Store heart rate max
        if (this.heartRate.heartRateMax < data) this.heartRate.heartRateMax = data;
        const zone = getZoneIndex(data, this.user.hrZones);
        if (zone != this.heartRate.heartRateZone) {
            this.heartRate.heartRateZone = zone;
            this.heartRate.heartRateZoneTime = 0;
            this.heartRate.heartRateZoneTick = now;
        } else {
            this.heartRate.heartRateZoneTime = Math.round((now - this.heartRate.heartRateZoneTick) / 1000);
        }

        // Accumulate the total average
        const dt = (now - this.heartRate.lastHrTime) / 1000;
        if (this.heartRate.lastHrTime > 0 && dt > 0 && dt <= 5) {
            this.heartRate.cumulativeHr += data * dt; // heartRate * seconds
            this.heartRate.elapsedHrTime += dt;       // total seconds
        }
        this.heartRate.lastHrTime = now;
    }

    private accumulateCadence(data: number) {
        // Store current cadence
        this.cadence.cadence = data;

        // Store cadence max
        if (this.cadence.cadenceMax < data) this.cadence.cadenceMax = data;   

        // Accumulate the total average
        this.cadence.cumulativeCad += data;
        this.cadence.cumulativeCadSize++;
    }

    public getPerformanceData(): PerformanceData {
        let aPower = 0;
        let aHeartRate = 0;
        let aCadence = 0;
        let nPower = 0;
        let iFactor = 0;
        let tsScore = 0;

        if (this.power.elapsedPwrTime > 0) {
            // Calculate average power
            aPower = this.power.cumulativePwr / this.power.elapsedPwrTime;
        }

        if (this.heartRate.elapsedHrTime > 0) {
            // Calculate average heart rate
            aHeartRate = this.heartRate.cumulativeHr / this.heartRate.elapsedHrTime;
        }

        if (this.cadence.cumulativeCadSize > 0) {
            // Calculate average cadence
            aCadence = this.cadence.cumulativeCad / this.cadence.cumulativeCadSize;
        }

        if (this.power.cumulativeNpSize) {
            // Calculate normalized power
            const averagePower4 = this.power.cumulativeNp / this.power.cumulativeNpSize;
            nPower = Math.pow(averagePower4, 0.25);

            if (this.user.ftp > 0) {
                // Calculate intensity factor
                iFactor = nPower / this.user.ftp;
    
                // Calculate training stress score
                const elapsedTime = (this.power.normalizedPowerTick - (this.power.normalizedStartTime || 0)) / 1000;
                tsScore = (elapsedTime * nPower * iFactor) / (this.user.ftp * 3600) * 100;
            } else {
                iFactor = tsScore = 0;
            }
        }

        return {
            power: this.power.power,
            powerMax: this.power.powerMax,
            powerZone: this.power.powerZone,
            powerZoneTime: this.power.powerZoneTime,
            heartRate: this.heartRate.heartRate,
            heartRateMax: this.heartRate.heartRateMax,
            heartRateZone: this.heartRate.heartRateZone,
            heartRateZoneTime: this.heartRate.heartRateZoneTime,
            cadence: roundNumber(this.cadence.cadence),
            cadenceMax: roundNumber(this.cadence.cadenceMax),
            normalizedPower: roundNumber(nPower),
            averagePower: roundNumber(aPower),
            averageHeartRate: roundNumber(aHeartRate),
            averageCadence: roundNumber(aCadence),
            intensityFactor: roundNumber(iFactor),
            trainingStressScore: roundNumber(tsScore)
        };
    }

    public onDataHandler(data: EventData): void {
        const now = performance.now();
        if (data.averagePower !== undefined && !isNaN(data.averagePower)) { // Skip if power data is not available
            // Check if this is the beginning of a series
            if (!this.power.normalizedStartTime) this.power.normalizedStartTime = now;
            // Accumulate power data
            this.accumulatePower(data.averagePower, now);
        }
        if (data.heartRate !== undefined && !isNaN(data.heartRate)) { // Skip if heart rate is not available
            // Accumulate heart rate data
            this.accumulateHeartRate(data.heartRate, now);
        }
        
        if (data.cadence !== undefined && !isNaN(data.cadence)) { // Skip if cadence is not available
            // Accumulate cadence data
            this.accumulateCadence(data.cadence);
        }
    }

    public cleanUp(): Promise<void> {
        this.power = newPowerData(this.power.normalizedPowerWindow);
        this.heartRate = newHeartRateData();
        this.cadence = newCadenceData();
        return Promise.resolve();
    }
}

/**
 * Utility function to crate a new PowerDataApp object
 */
function newPowerData(npWindow: number): PowerDataApp {
    return {
        power: 0,
        powerMax: 0,
        powerZone: 0,
        powerZoneTime: 0,
        powerZoneTick: 0,
        cumulativePwr: 0,
        lastPwrTime: 0,
        elapsedPwrTime: 0,
        cumulativeNp: 0,
        cumulativeNpSize: 0,
        normalizedPowerWindow: npWindow ?? 30 * 1000,
        normalizedStartTime: 0,
        normalizedPowerTick: 0,
        normalizedPowerBuffer: [] as TimestampData[]
    } as PowerDataApp;
}

/**
 * Utility function to create a new HeartRateApp object
 */
function newHeartRateData(): HeartRateDataApp {
    return {
        heartRate: 0,
        heartRateMax: 0,
        heartRateZone: 0,
        heartRateZoneTime: 0,
        heartRateZoneTick: 0,
        cumulativeHr: 0,
        lastHrTime: 0,
        elapsedHrTime: 0
    } as HeartRateDataApp;
}

/**
 * Utility function to create a new CadenceApp object
 */
function newCadenceData(): CadenceDataApp {
    return {
        cadence: 0,
        cadenceMax: 0,
        cumulativeCad: 0,
        cumulativeCadSize: 0
    } as CadenceDataApp;
}

/**
 * Utility funciton to convert the heart rate zones based on percentage of HRR to
 * heart rate beats following the Karvonen method
 * 
 * @param rest Rest heart rate
 * @param max Max heart rate
 * @param zones Array of heart rate ranges (percentage of rest heart rate)
 * 
 * @returns An array of heart rate ranges (beats per minute)
 */
function convertHeartRateZones(rest: number, max: number, zones: number[][]): number[][] {
    // The returned array must have continuous numbers otherwise `getZoneIndex` will fail
    const hrReserve = max - rest;
    let minCache = Math.round(zones[0][0] / 100 * hrReserve + rest);
    return zones.map((entry) => {
        const newMin = minCache;
        const newMax = Math.round(entry[1] / 100 * hrReserve + rest);
        minCache = newMax;
        return [ newMin, newMax ];
    });
}

/**
 * Utility function to convert the power zones based on percentage of FTP to watts
 * based on FTP
 * 
 * @param ftp: Functional threshold power
 * @param zones: Array of power ranges (percentage of FTP)
 * 
 * @returns An array of power ranges (watts)
 */
function convertPowerZones(ftp: number, zones: number[][]): number[][] {
    // The returned array must have continuous numbers otherwise `getZoneIndex` will fail
    let minCache = Math.round(zones[0][0] * ftp / 100);
    return zones.map((entry) => {
        const newMin = minCache;
        const newMax = Math.round(entry[1] * ftp / 100);
        minCache = newMax;
        return [ newMin, newMax ];
    });
}

/**
 * Utility function to identify the index of a given zone array based on the provided
 * argument. It can be applied to both heart rate zone as well as power zone arrays
 * 
 * @param value The provided heart rate or power value
 * @param zones The array of arrays containing the zone mapping
 * 
 * @returns The corresponding zone index
 */
function getZoneIndex(value: number, zones: number[][]): number {
    if (value < zones[0][0]) return 1;
    if (value >= zones[zones.length-1][1]) return zones.length;
    return zones.findIndex(([min,max]) => value >= min && value <= max) + 1;
}

/**
 * Utility function to calculate the moving average of an array of TimestampData
 * 
 * @param data: Array of TimestampData
 * 
 * @returns The average data within the series
 */
function calculateMovingAverage(data: TimestampData[]): number {
    if (data.length === 0) {
        return 0;
    }
    const movingAverage = data.reduce((sum, entry) => sum + entry.data, 0);
    return movingAverage / data.length;
}

/**
 * Utility function to round numbers to at most 2 decimal places
 * 
 * @param num A number to round
 * 
 * @returns Rounded number
 */
function roundNumber(num: number): number {
    // This is not bulletproof but should do (ex: 1.3549999999999998 will not round properly)
    return Math.round((num + Number.EPSILON) * 100) / 100;
}