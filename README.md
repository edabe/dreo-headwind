# dreo-headwind
Trying to put together a rudimentary version of a smart fan for workout sessions (primarily cycling) leveraging the smart Dreo fan DR-HAF004S (CF714S) with its vertical and horizontal oscillating capabilities, an old Raspberry Pi and old USB ANT+ stick.

This is a good opportunity to learn a bit of TypeScript and the ANT+ protocol while creating something that fits my needs better; for instance, I would like to have the fan pointing at my bike trainer when cycling indoors, but also have it tilt and point to a rowing machine while always adjusting the air speed to my heart rate.

I hope this will get somewhere.

## Thought process
As I flip through some of the ANT+ public documentation, I am thinking about the basic functionality of the application:
- App will behave as _continuous scanning node_, allowing it to receive and process data from multiple transmit nodes (masters).
- I have multiple ANT devices but only some will be used to control the smart fan, so the app should have a list of "allowed" devices, namely:
  - FE-C trainer
  - PWR on each bike (for cadence)
  - HRM strap


## Special Thanks
This project is deriived from the following projects:
- Project config tips to [set up a console Node app](https://phillcode.io/nodejs-console-app-with-typescript-linting-and-testing)
- DreoAPI from the [zyonse/homebridge-dreo](https://github.com/zyonse/homebridge-dreo)
- ANT+ implementation from [incyclist/ant-plus](https://github.com/incyclist/ant-plus)
- ANT+ basics from [thisisant.com](https://www.thisisant.com/developer/ant/ant-basics/)
And probably bits and pieces from other sources - I'll do my best to list them all.
