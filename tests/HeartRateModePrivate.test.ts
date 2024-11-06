import rewire from "rewire";
import nconf from 'nconf';
import { Logger, ILogObj } from 'tslog';

import { DreoAPI, DreoState } from '../src/DreoAPI';
import { DreoProfileType, DreoProfiles } from "../src/DreoProfile";
import HeartRateMode from '../src/HeartRateMode';

// Initialize logger
const logger = new Logger<ILogObj>({ 
    name: 'dreo-headwind-logger',
    minLevel: 3
});

// Load configuration file
nconf.file({ file: `${process.cwd()}/config/config.json` }).argv().env();
nconf.set('user.heartrate', {
    "zones": [ [40,60], [60,70], [70,80], [80,90], [90,100] ],
    "max": 180,
    "rest": 55
});

// Mock DreoAPI
jest.mock('../src/DreoAPI');
const mockDreoAPI = jest.mocked(DreoAPI, { shallow: false });

// Heart rate mode instance
let hrm: any;
beforeAll(() => {
});

beforeEach(() => {
    // Arrange
    hrm = new HeartRateMode(logger, nconf);

    // Assert
    // DreoAPI constructor
    expect(DreoAPI).toHaveBeenCalledTimes(1); 
});

afterEach(() => {
    mockDreoAPI.mockClear();
});

describe('HeartRateMode', () => {
    describe('Handler functions', () => {
        describe('Checks that onDataHandler works as expected', () => {

        });

        describe('Checks that onDetectedHandler works as expected', () => {
        });
    });

    describe('Profile functions', () => {
        // it('Checks that applyProfile works as expected', async () => {
        //     // Assert
        //     const spyProfileCenter_0 = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_0], 'apply');
        //     const spyProfileCenter_30 = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_30], 'apply');
        //     const spyAirCirculatorSpeed = jest.spyOn(hrm.dreo, 'airCirculatorSpeed');

        //     // Act
        //     await hrm.applyProfile(DreoProfileType.CENTER_0, 1);

        //     // Assert
        //     // DreoProfileType.CENTER_0 is the new current profile, speed 1
        //     expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_0);
        //     expect(hrm.currentSpeed).toBe(1);
        //     expect(spyProfileCenter_0).toHaveBeenCalledTimes(1);
        //     expect(spyProfileCenter_0).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
        //     expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 1);
        //     expect(spyProfileCenter_30).toHaveBeenCalledTimes(0);

        //     // Act
        //     await hrm.applyProfile(DreoProfileType.CENTER_0, 1);

        //     // Assert
        //     // No changes to currentProfile and/or currentSpeed
        //     expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_0);
        //     expect(hrm.currentSpeed).toBe(1);
        //     expect(spyProfileCenter_0).toHaveBeenCalledTimes(1);
        //     expect(spyProfileCenter_0).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
        //     expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 1);
        //     expect(spyProfileCenter_30).toHaveBeenCalledTimes(0);

        //     // Act
        //     await hrm.applyProfile(DreoProfileType.CENTER_0, 2);

        //     // Assert
        //     // Changes currentSpeed, DreoProfileType.CENTER_0.apply should have been called
        //     expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_0);
        //     expect(hrm.currentSpeed).toBe(2);
        //     expect(spyProfileCenter_0).toHaveBeenCalledTimes(2);
        //     expect(spyProfileCenter_0).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
        //     expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 2);
        //     expect(spyProfileCenter_30).toHaveBeenCalledTimes(0);

        //     // Act
        //     await hrm.applyProfile(DreoProfileType.CENTER_30, 2);

        //     // Assert
        //     // Changes currentProfile:
        //     // - DreoProfileType.CENTER_0.apply should not have been called
        //     // - DreoProfileTyoe.CENTER_30.apply should have been called
        //     expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_30);
        //     expect(hrm.currentSpeed).toBe(2);
        //     expect(spyProfileCenter_0).toHaveBeenCalledTimes(2);
        //     expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 2);
        //     expect(spyProfileCenter_30).toHaveBeenCalledTimes(1);
        //     expect(spyProfileCenter_30).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
        // });

        describe('Checks that adjustDreoProfile works as expected', () => {
            let spyDreoGetState: any;
            let spyDreoAirCirculatorSpeed: any;
            let spyGetFanSpeed: any;
            let spyAdjustSpeedForTemperature: any;
            let spyProfileCenter0Apply: any;
            let spyProfileCenter30Apply: any;
            let spyProfileCenter45Apply: any;
            let spyProfileVerticalApply: any;
            let spyLoggerDebug: any;

            beforeEach(() => {
                spyDreoGetState = jest.spyOn(hrm.dreo, 'getState');
                spyDreoAirCirculatorSpeed = jest.spyOn(hrm.dreo, 'airCirculatorSpeed');
                spyGetFanSpeed = jest.spyOn(hrm, 'getFanSpeed');
                spyAdjustSpeedForTemperature = jest.spyOn(hrm, 'adjustSpeedForTemperature');
                spyProfileCenter0Apply = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_0], 'apply');
                spyProfileCenter30Apply = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_30], 'apply');
                spyProfileCenter45Apply = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_45], 'apply');
                spyProfileVerticalApply = jest.spyOn(DreoProfiles[DreoProfileType.VERTICAL], 'apply');
                spyLoggerDebug = jest.spyOn(hrm.logger, 'debug');
            });

            afterEach(() => {
                spyDreoGetState.mockClear();
                spyDreoAirCirculatorSpeed.mockClear();
                spyGetFanSpeed.mockClear();
                spyAdjustSpeedForTemperature.mockClear();
                spyProfileCenter0Apply.mockClear();
                spyProfileCenter30Apply.mockClear();
                spyProfileCenter45Apply.mockClear();
                spyProfileVerticalApply.mockClear();
                spyLoggerDebug.mockClear();
                clearInterval(hrm.profileOverrideTimer);
            });

            it('Checks that isAdjustDreoProfileBusy works', async () => {                
                // Arrange
                hrm.isAdjustDreoProfileBusy = true;

                // Act
                await hrm.adjustDreoProfile();

                // Assert
                expect(spyLoggerDebug).toHaveBeenCalledWith("Skipping DREO profile adjustment: busy");
            });

            function setTest(speed: number): void {
                spyGetFanSpeed.mockClear();
                hrm.hrProfile = DreoProfileType.HORIZONTAL;
                spyGetFanSpeed.mockImplementation(() => speed);
            }

            it('Checks adjustDreoProfile scenarios', async () => {
                // Arrange
                hrm.profileOverrideLastUpdate = Infinity; // Prevent profile override
                spyDreoGetState.mockImplementation((sn: string) => { return {temperature: 75, windlevel: 9 }; });
                
                // Act and assert
                // Speed 1
                setTest(1);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter0Apply).toHaveBeenCalledTimes(1);
            
                // Speed 2
                setTest(2);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter30Apply).toHaveBeenCalledTimes(1);

                // Speed 3
                setTest(3);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter30Apply).toHaveBeenCalledTimes(2);

                // Speed 4
                setTest(4);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(1);

                // Speed 5
                setTest(5);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(2);

                // Speed 6
                setTest(6);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(3);
                
                // Speed 7
                setTest(7);
                await hrm.adjustDreoProfile();
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(4);

                // Assert
                expect(spyDreoGetState).toHaveBeenCalledTimes(7);
                expect(spyAdjustSpeedForTemperature).toHaveBeenCalledTimes(7);
                expect(spyProfileCenter0Apply).toHaveBeenCalledTimes(1);
                expect(spyProfileCenter30Apply).toHaveBeenCalledTimes(2);
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(4);
                expect(spyProfileVerticalApply).toHaveBeenCalledTimes(0);
                expect(spyDreoAirCirculatorSpeed).toHaveBeenCalledTimes(7);
            });

            it('Checks oscillation scenario', async () => {
                // Arrange
                spyDreoGetState.mockImplementation((sn: string) => { return {temperature: 60, windlevel: 9 }; });
                spyGetFanSpeed.mockImplementation(() => 1);
                
                // Act                
                hrm.profileOverrideLastUpdate = 0; // Ensure oscillate profile override is triggered
                await hrm.adjustDreoProfile();
                hrm.hrModeUpdateFrequency = Infinity; // Ensure trigger is disabled
                await hrm.adjustDreoProfile();

                // Assert
                expect(spyDreoGetState).toHaveBeenCalledTimes(2);
                expect(spyGetFanSpeed).toHaveBeenCalledTimes(2);
                expect(spyAdjustSpeedForTemperature).toHaveBeenCalledTimes(2);
                expect(spyProfileCenter0Apply).toHaveBeenCalledTimes(1);
                expect(spyProfileCenter30Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileVerticalApply).toHaveBeenCalledTimes(1);
                expect(spyDreoAirCirculatorSpeed).toHaveBeenCalledTimes(2);
            });

            /**
             * This test assumes profile override frequency to be 10 seconds, with override duration to be 5 seconds.
             * 
             * The first call to adjustDreoProfile will trigger the profile oscillation override, which sould be in
             * effect for the next 5 seconds.
             * 
             * During this time, the profile should always be DreoProfileType.HORIZONTAL.
             * 
             * After 5 seconds, the profile should be set to DreoProfileType.CENTER_0.
             */
            it('Checks oscillation frequency', async () => {
                // Arrange
                hrm.profileOverrideFrequency = 10000;
                hrm.profileOverrideDuration = 5000;
                // Forces HRM
                hrm.profileOverrideLastUpdate = Date.now() - hrm.profileOverrideFrequency - 1;
                spyDreoGetState.mockImplementation((sn: string) => { return {temperature: 60, windlevel: 1 }; });
                const promises: Promise<any>[] = [];

                // Act and assert
                hrm.hrModeUpdateFrequency = Infinity;
                for (let i = 0; i < 6; i++) {
                    promises.push(new Promise((resolve) => {
                        setTimeout(async () => {
                            await hrm.adjustDreoProfile();
                            resolve(i);
                        }, i * 1000);
                    }));
                }
                await Promise.all(promises);
                // Profile oscillation override should still be in place (5 seconds out of 10)
                expect(hrm.profileOverrideTimer).not.toBeNull;
                expect(spyDreoGetState).toHaveBeenCalledTimes(6);
                expect(spyProfileCenter0Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileCenter30Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileVerticalApply).toHaveBeenCalledTimes(1);
                expect(hrm.hrProfile).toBe(DreoProfileType.VERTICAL);

                // Profile oscillation override should have ended, reverting to normal
                hrm.hrModeUpdateFrequency = 0;
                for (let i = 0; i < 6; i++) {
                    promises.push(new Promise((resolve) => {
                        setTimeout(async () => {
                            await hrm.adjustDreoProfile();
                            resolve(i);
                        }, i * 1000);
                    }));
                }
                await Promise.all(promises);
                expect(hrm.profileOverrideTimer).toBeNull;
                expect(spyDreoGetState).toHaveBeenCalledTimes(12);
                expect(spyProfileCenter0Apply).toHaveBeenCalledTimes(1);
                expect(spyProfileCenter30Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileCenter45Apply).toHaveBeenCalledTimes(0);
                expect(spyProfileVerticalApply).toHaveBeenCalledTimes(1);
                expect(hrm.hrProfile).toBe(DreoProfileType.CENTER_0);
            }, 15000);
        });
    });

    describe('Utility functions', () => {
        function testFanSpeed(hrZones: number[][], index: number): number[] {
            const result: number[] = [];
            hrm.hrSmoothed = hrZones[index][0]-1;
            result.push(hrm.getFanSpeed());
            hrm.hrSmoothed = hrZones[index][0];
            result.push(hrm.getFanSpeed());
            hrm.hrSmoothed = hrZones[index][0]+1;
            result.push(hrm.getFanSpeed());
            hrm.hrSmoothed = Math.round((hrZones[index][1] + hrZones[index][0])/2);
            result.push(hrm.getFanSpeed());
            hrm.hrSmoothed = hrZones[index][1]-1;
            result.push(hrm.getFanSpeed());
            hrm.hrSmoothed = hrZones[index][1];
            result.push(hrm.getFanSpeed());
            hrm.hrSmoothed = hrZones[index][1]+1;
            result.push(hrm.getFanSpeed());
            return result;
        };

        it('Checks that getFanSpeed works as expected', () => {
            // Arrange
            const minFanSpeed = 1;
            const maxFanSpeed = 7;
            const hrConfig = nconf.get('user.heartrate');
            const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);

            // Act and Assert
            // Zone 1 - speeds 1-2
            expect(testFanSpeed(hrZones, 0)).toEqual([1, 1, 1, 2, 2, 2, 2]);

            // Zone 2 - speeds 2-3
            expect(testFanSpeed(hrZones, 1)).toEqual([2, 2, 2, 3, 3, 3, 3]);

            // Zone 3 - speeds 3-4
            expect(testFanSpeed(hrZones, 2)).toEqual([3, 3, 3, 4, 4, 4, 4]);

            // Zone 4 - speeds 4-5
            expect(testFanSpeed(hrZones, 3)).toEqual([4, 4, 4, 5, 5, 5, 5]);

            // Zone 5 - speeds 5-7
            expect(testFanSpeed(hrZones, 4)).toEqual([5, 5, 5, 6, 7, 7, 7]);
        });

        it('Checks that adjustSpeedForTemperature works as expected', () => {
            // Arrange
            // Nothing to be done

            // Act
            // Nothing to be done

            // Assert
            // Less than 65F
            expect(hrm.adjustSpeedForTemperature(1, 64)).toBe(1);
            expect(hrm.adjustSpeedForTemperature(2, 64)).toBe(1);

            // At 65F
            expect(hrm.adjustSpeedForTemperature(1, 65)).toBe(1);

            // Less than 75F
            expect(hrm.adjustSpeedForTemperature(1, 70)).toBe(1);

            // At 75F
            expect(hrm.adjustSpeedForTemperature(1, 75)).toBe(1);

            // Less than 85F
            expect(hrm.adjustSpeedForTemperature(1, 76)).toBe(2);
            expect(hrm.adjustSpeedForTemperature(9, 76)).toBe(9);
            
            // At 85F
            expect(hrm.adjustSpeedForTemperature(1, 85)).toBe(2);
            expect(hrm.adjustSpeedForTemperature(9, 85)).toBe(9);

            // Greater than 85F
            expect(hrm.adjustSpeedForTemperature(1, 86)).toBe(3);
            expect(hrm.adjustSpeedForTemperature(7, 86)).toBe(9);
            expect(hrm.adjustSpeedForTemperature(8, 86)).toBe(9);
            expect(hrm.adjustSpeedForTemperature(9, 86)).toBe(9);
        });

        it('Checks that getHeartRateZones works as expected', () => {
            // Arrange
            const hrConfig = nconf.get('user.heartrate');

            // Act
            const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);

            // Assert
            expect(hrZones[0][0]).toBe(105);
            expect(hrZones[0][1]).toBe(130);
            expect(hrZones[1][0]).toBe(130);
            expect(hrZones[1][1]).toBe(143);
            expect(hrZones[2][0]).toBe(143);
            expect(hrZones[2][1]).toBe(155);
            expect(hrZones[3][0]).toBe(155);
            expect(hrZones[3][1]).toBe(168);
            expect(hrZones[4][0]).toBe(168);
            expect(hrZones[4][1]).toBe(180);
        });

        function testHeartRateZone(hrZones: number[][], index: number): number[] {
            const result: number[] = [];
            hrm.hrSmoothed = hrZones[index][0]-1;
            result.push(hrm.getHeartRateZone());
            hrm.hrSmoothed = hrZones[index][0];
            result.push(hrm.getHeartRateZone());
            hrm.hrSmoothed = hrZones[index][0]+1;
            result.push(hrm.getHeartRateZone());
            hrm.hrSmoothed = hrZones[index][1]-1;
            result.push(hrm.getHeartRateZone());
            hrm.hrSmoothed = hrZones[index][1];
            result.push(hrm.getHeartRateZone());
            hrm.hrSmoothed = hrZones[index][1]+1;
            result.push(hrm.getHeartRateZone());
            return result;
        };

        it('Checks that getHeartRateZone works as expected', () => {   
            // Arrange
            const hrConfig = nconf.get('user.heartrate');
            const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones) as number[][];
            
            // Act and Assert
            // Zone 1
            expect(testHeartRateZone(hrZones, 0)).toEqual([1, 1, 1, 1, 1, 2]);

            // Zone 2
            expect(testHeartRateZone(hrZones, 1)).toEqual([1, 1, 2, 2, 2, 3]);

            // Zone 3
            expect(testHeartRateZone(hrZones, 2)).toEqual([2, 2, 3, 3, 3, 4]);

            // Zone 4
            expect(testHeartRateZone(hrZones, 3)).toEqual([3, 3, 4, 4, 4, 5]);

            // Zone 5
            expect(testHeartRateZone(hrZones, 4)).toEqual([4, 4, 5, 5, 5, 5]);
        });
    });
});
