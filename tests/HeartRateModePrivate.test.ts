import rewire from "rewire";
import nconf from 'nconf';
import { Logger, ILogObj } from 'tslog';

import { DreoAPI } from '../src/DreoAPI';
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
    describe('Profile functions', () => {
        it('Checks that applyProfile works as expected', async () => {
            // Assert
            const spyProfileCenter_0 = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_0], 'apply');
            const spyProfileCenter_30 = jest.spyOn(DreoProfiles[DreoProfileType.CENTER_30], 'apply');
            const spyAirCirculatorSpeed = jest.spyOn(hrm.dreo, 'airCirculatorSpeed');

            // Act
            await hrm.applyProfile(DreoProfileType.CENTER_0, 1);

            // Assert
            // DreoProfileType.CENTER_0 is the new current profile, speed 1
            expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_0);
            expect(hrm.currentSpeed).toBe(1);
            expect(spyProfileCenter_0).toHaveBeenCalledTimes(1);
            expect(spyProfileCenter_0).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
            expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 1);
            expect(spyProfileCenter_30).toHaveBeenCalledTimes(0);

            // Act
            await hrm.applyProfile(DreoProfileType.CENTER_0, 1);

            // Assert
            // No changes to currentProfile and/or currentSpeed
            expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_0);
            expect(hrm.currentSpeed).toBe(1);
            expect(spyProfileCenter_0).toHaveBeenCalledTimes(1);
            expect(spyProfileCenter_0).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
            expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 1);
            expect(spyProfileCenter_30).toHaveBeenCalledTimes(0);

            // Act
            await hrm.applyProfile(DreoProfileType.CENTER_0, 2);

            // Assert
            // Changes currentSpeed, DreoProfileType.CENTER_0.apply should have been called
            expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_0);
            expect(hrm.currentSpeed).toBe(2);
            expect(spyProfileCenter_0).toHaveBeenCalledTimes(2);
            expect(spyProfileCenter_0).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
            expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 2);
            expect(spyProfileCenter_30).toHaveBeenCalledTimes(0);

            // Act
            await hrm.applyProfile(DreoProfileType.CENTER_30, 2);

            // Assert
            // Changes currentProfile:
            // - DreoProfileType.CENTER_0.apply should not have been called
            // - DreoProfileTyoe.CENTER_30.apply should have been called
            expect(hrm.currentProfile).toBe(DreoProfileType.CENTER_30);
            expect(hrm.currentSpeed).toBe(2);
            expect(spyProfileCenter_0).toHaveBeenCalledTimes(2);
            expect(spyAirCirculatorSpeed).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, 2);
            expect(spyProfileCenter_30).toHaveBeenCalledTimes(1);
            expect(spyProfileCenter_30).toHaveBeenLastCalledWith(hrm.dreoSerialNumber, hrm.dreo);
        });

        describe('Checks that adjustDreoProfile works as expected', () => {
            it('Checks that isBusy works', async () => {
                // Arrange
                hrm.isBusy = true;
                const spyLogger = jest.spyOn(hrm.logger, 'info');

                // Act
                await hrm.adjustDreoProfile();

                // Assert
                expect(spyLogger).toHaveBeenCalledWith("Skipping DREO profile adjustment: busy");
            });


            it('Checks that case-default works', async () => {
                // Arrange
                const hrConfig = nconf.get('user.heartrate');
                const spyGetState = jest.spyOn(hrm.dreo, 'getState').mockImplementation((sn) => { return { poweron: true }; });
                hrm.hrHistory = Array(hrConfig.sampleSize).fill(0);
                const spyGetHRZ = jest.spyOn(hrm, 'getHeartRateZone').mockImplementation((avg) => 0);
                const spyLogger = jest.spyOn(hrm.logger, 'info');
                const spyAirCirculatorSpeed = jest.spyOn(hrm.dreo, 'airCirculatorSpeed');
                const spyAirCirculatorPowerOn = jest.spyOn(hrm.dreo, 'airCirculatorPowerOn');
                
                // Act 
                await hrm.adjustDreoProfile();
                // Assert
                expect(spyGetState).toHaveBeenCalledTimes(1);
                expect(spyLogger).toHaveBeenLastCalledWith('Adjusting DREO profile to Zone 0', '0.00', true);
                expect(spyGetHRZ).toHaveBeenCalledWith(0);
                expect(spyAirCirculatorSpeed).toHaveBeenCalledWith(hrm.dreoSerialNumber, 1);
                expect(spyAirCirculatorPowerOn).toHaveBeenCalledWith(hrm.dreoSerialNumber, false);
            });

            // it('Checks that case-1 works', async () => {
            //     // Arrange
            //     const hrConfig = nconf.get('user.heartrate');
            //     const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);
            //     hrm.hrHistory = Array(hrConfig.sampleSize).fill(hrZones[0][1]-1);
                
            //     // Act
            //     // TBD
    
            // });

            // it('Checks that case-2 works', async () => {
            //     // Arrange
            //     const hrConfig = nconf.get('user.heartrate');
            //     const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);
            //     hrm.hrHistory = Array(hrConfig.sampleSize).fill(hrZones[0][1]);
                
            //     // Act
            //     // TBD
    
            // });

            // it('Checks that case-3 works', async () => {
            //     // Arrange
            //     const hrConfig = nconf.get('user.heartrate');
            //     const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);
            //     hrm.hrHistory = Array(hrConfig.sampleSize).fill(hrZones[1][1]);
                
            //     // Act
            //     // TBD
    
            // });

            // it('Checks that case-4 works', async () => {
            //     // Arrange
            //     const hrConfig = nconf.get('user.heartrate');
            //     const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);
            //     hrm.hrHistory = Array(hrConfig.sampleSize).fill(hrZones[2][1]);
                
            //     // Act
            //     // TBD
                
    
            // });

            // it('Checks that case-5 works', async () => {
            //     // Arrange
            //     const hrConfig = nconf.get('user.heartrate');
            //     const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);
            //     hrm.hrHistory = Array(hrConfig.sampleSize).fill(hrZones[3][1]);
                
            //     // Act
            //     // TBD
                
    
            // });
        });

        it('Checks that applyProfile works as expected', () => {
            // TBD
        });
    });

    describe('Utility functions', () => {
        it('Checks that getHeartRateZones works as expected', () => {
            // Arrange
            const hrConfig = nconf.get('user.heartrate');

            // Act
            const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);

            // Assert
            expect(hrZones[0][0]).toBe(105);
            expect(hrZones[0][1]).toBe(130);
            expect(hrZones[1][0]).toBe(130);
            expect(hrZones[1][1]).toBe(142.5);
            expect(hrZones[2][0]).toBe(142.5);
            expect(hrZones[2][1]).toBe(155);
            expect(hrZones[3][0]).toBe(155);
            expect(hrZones[3][1]).toBe(167.5);
            expect(hrZones[4][0]).toBe(167.5);
            expect(hrZones[4][1]).toBe(180);
        });

        it('Checks that getSpeedOffset works as expected', () => {
            // Arrange
            const min = Math.floor(Math.random() * (100 - 55) + 55);
            const max = Math.floor(Math.random() * (210 - 101) + 101);
            const range = [min, max];
            const split1 = [0, 0];
            const split2 = [0, 0, 0];
            
            // Act 
            for (let i = range[0]; i < range[1]; i++) {
                split1[hrm.getSpeedOffset(range[0], range[1], i, 1)]++;
                split2[hrm.getSpeedOffset(range[0], range[1], i, 2)]++;
            }

            // Assert
            expect(hrm.getSpeedOffset(range[0], range[1], Math.random() * 200 + 100, 0)).toBe(0);
            expect(hrm.getSpeedOffset(10, 20, 20, 11)).toBe(10);

            expect(split1[0] + split1[1]).toBe(range[1] - range[0]);
            expect(split2[0] + split2[1] + split2[2]).toBe(range[1] - range[0]);

            expect(Math.abs(split1[0] - split1[1])).toBeLessThanOrEqual(1);
            expect(Math.abs(split2[0] - split2[1])).toBe(0);
            expect(Math.abs(split2[1] - split2[2])).toBeLessThanOrEqual(2);
        });

        it('Checks that getHeartRateZone works as expected', () => {   
            // Arrange
            const hrConfig = nconf.get('user.heartrate');
            const hrZones = hrm.getHeartRateZones(hrConfig.rest, hrConfig.max, hrConfig.zones);
            
            // Act and Assert
            expect(hrm.getHeartRateZone(hrZones[0][0]-1)).toBe(0);
            expect(hrm.getHeartRateZone(hrZones[0][0])).toBe(0);

            expect(hrm.getHeartRateZone(hrZones[0][1]-1)).toBe(1);

            expect(hrm.getHeartRateZone(hrZones[0][1])).toBe(2);
            expect(hrm.getHeartRateZone(hrZones[1][0])).toBe(2);
            expect(hrm.getHeartRateZone(hrZones[1][1]-1)).toBe(2);

            expect(hrm.getHeartRateZone(hrZones[1][1])).toBe(3);
            expect(hrm.getHeartRateZone(hrZones[2][0])).toBe(3);
            expect(hrm.getHeartRateZone(hrZones[2][1]-1)).toBe(3);

            expect(hrm.getHeartRateZone(hrZones[2][1])).toBe(4);
            expect(hrm.getHeartRateZone(hrZones[3][0])).toBe(4);
            expect(hrm.getHeartRateZone(hrZones[3][1]-1)).toBe(4);

            expect(hrm.getHeartRateZone(hrZones[3][1])).toBe(5);
            expect(hrm.getHeartRateZone(hrZones[4][0])).toBe(5);
            expect(hrm.getHeartRateZone(hrZones[4][1]-1)).toBe(5);
            expect(hrm.getHeartRateZone(hrZones[4][1])).toBe(5);
            expect(hrm.getHeartRateZone(hrZones[4][1]+1)).toBe(5);
        });
    });
});
