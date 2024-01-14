# dreo-headwind
Trying to put together a rudimentary version of a smart fan for workout sessions (primarily cycling) leveraging the smart [Dreo fan DR-HAF004S (CF714S)](https://a.co/d/0jFntRD) with its vertical and horizontal oscillating capabilities, an old Raspberry Pi and old USB ANT+ stick.

This is a good opportunity to learn a bit of TypeScript and the ANT+ protocol while creating something that fits my needs better; for instance, I would like to have the fan pointing at my bike trainer when cycling indoors, but also have it tilt and point to a rowing machine while always adjusting the air speed to my heart rate.

I hope this will be helpful to others.

**NOTE:** The API used to control the DREO fan is _not public_, so this integration can stop working without previous notice.

## Setup
Still work in progress, but this is how to set it up. Tested both on a macbook laptop (Sonoma) and Raspberry Pi (Debian bookworm)

#### Raspbery pi 
- Connect to the Raspberry pi
- Insert the USB stick 
- Check that it is being recognized
    ```
    eabe@rpi:~ $ lsusb
    Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
    Bus 001 Device 004: ID 0fcf:1008 Dynastream Innovations, Inc. ANTUSB2 Stick
    Bus 001 Device 002: ID 2109:3431 VIA Labs, Inc. Hub
    Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
    ```
- My USB stick is described as `Bus 001 Device 004: ID 0fcf:1008 Dynastream Innovations, Inc. ANTUSB2 Stick` from where we can get:
    - idVendor: `0fcf`
    - idProduct: `1008`
- Unplug the USB stick
- Create a `udev` rule to get the USB serial kernel driver to create a node for the USB stick
    ```
    eabe@rpi:~ $ sudo vi /etc/udev/rules.d/ant-usb-m.rules
    ```
- With the following content (adjust `idVendor` and `idProduct` based on your own USB stick):
    ```
    SUBSYSTEM=="usb", ATTRS{idVendor}=="0fcf", ATTRS{idProduct}=="1008", RUN+="/sbin/modprobe usbserial vendor=0x0fcf product=0x1008", MODE="0666", GROUP="users"
    ```
- Re-insert the USB stick and check that a `/dev/ttyUSB0` node was created:
    ```
    eabe@rpi:~ $ ls -la /dev/ttyUSB0 
    crw-rw---- 1 root dialout 188, 0 Nov 12 13:37 /dev/ttyUSB0
    ```
    - Note that for me the `MODE` and `GROUP` defined in the `udev` rule is ignored - the node has mode `660` and group `dialout`. Make sure your app user is member of the group.

#### Check-out and compile
- Install dependencies: `npm install`
- Build code: `npm run build`

#### Configuration
The application relies on a config file loaded by `nconf`:
- Create a `config` folder in the project directory
    ```
    mkdir ./config
    ```
- Create a `config.json` file based on the template below:
    ```
    {
        "dreo.config": {
            "email": "<your_dreo_app_email>",
            "password": "<your_dreo_app_password>",
            "server": "us",
            "serialNumber": "<your_dreo_fan_serial_number>"
        },

        "ant.allowed_devices": {
            "hr": "<ant_id_of_your_heartrate_sensor>"
        },

        "user.heartrate": {
            "zones": [ [<z1_min_hr%>,<z1_max_hr%>], [<z2_min_hr%>,<z2_max_hr%>], [<z3_min_hr%>,<z3_max_hr%>], [<z4_min_hr%>,<z4_max_hr%>], [<z5_min_hr%>,<z5_max_hr%>] ],
            "max": <your_max_hr>,
            "rest": <your_rest_hr>
        }
    }
    ```
    Note that the heart rate zone is defined as a percentage of your max heart-rate.

#### Running the application
- Run the app: `npm run start`

The app will scan for your heart rate monitor; once it finds it, it will start gathering data to control the Dreo fan. The mobile app and/or fan controls will override the controls sent from this app, but only temporarily - by default, this app is sampling and adjusting the fan settings every 30 seconds.

#### Running at startup (Raspberry pi)
- Create a _systemd_ service file: 
```
eabe@rpi:~ $ sudo vi /etc/systemd/system/dreo-headwind.service
```

File contents:
```
[Unit]
Description=Dreo Headwind smart fitness fan
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=5
User=eabe
WorkingDirectory=/home/eabe/antplus/dreo-headwind
ExecStart=npm run start

[Install]
WantedBy=multi-user.target
```

- Configure the new service to start on boot: 
```
eabe@rpi:~ $ sudo systemctl enable dreo-headwind
```

- Start the service:
```
eabe@rpi:~ $ sudo systemctl start dreo-headwind
```

- Check that the service is running:
```
eabe@rpi:~ $ ps -ef |grep dreo
eabe        1131    1126 18 14:29 ?        00:00:18 node /home/eabe/antplus/dreo-headwind/node_modules/.bin/ts-node ./src/index.ts
eabe        1884    1163  0 14:30 pts/0    00:00:00 grep --color=auto dreo
```

- Logs are available via [_journalctl_](https://www.loggly.com/ultimate-guide/using-journalctl/):
```
eabe@rpi:~ $ sudo journalctl -u dreo-headwind.service -f
```

You can now start, stop and restart the app manually as well
```
sudo systemctl start dreo-headwind
sudo systemctl stop dreo-headwind
sudo systemctl restart dreo-headwind
```

## Thought process
As I flip through some of the ANT+ public documentation, I am thinking about the basic functionality of the application:
- App will behave as _continuous scanning node_, allowing it to receive and process data from multiple transmit nodes (masters).
- I have multiple ANT devices but only some will be used to control the smart fan, so the app should have a list of "allowed" devices, namely:
  - FE-C trainer
  - PWR on each bike (for cadence)
  - HRM strap

## Possible features
- Adjust the fan speed based on the fan's temperature sensor
- Simulate riding experience (ex: fan speed matching virtual speed) based on data from smart trainer
- Improve heart rate logic and make it smarter
- Integrate with Home Assistant to rely on additional sensors / automations
- Support my other trainer (2 trainers next to each other - have the fan point to either one or the other)
- Set app as an `Express` server hosting a display / config web app
- Make the app listen to (and respond to) the fan websocket messages so that specific fan controls can override the app behavior (ex: enabling _Sleep Mode_ could instruct the app to stop controlling the fan until the end of the session)

## Special Thanks
This project is deriived from the following projects:
- Project config tips to [set up a console Node app](https://phillcode.io/nodejs-console-app-with-typescript-linting-and-testing)
- DreoAPI from the [zyonse/homebridge-dreo](https://github.com/zyonse/homebridge-dreo)
- ANT+ implementation from [incyclist/ant-plus](https://github.com/incyclist/ant-plus)
- ANT+ basics from [thisisant.com](https://www.thisisant.com/developer/ant/ant-basics/)
And probably bits and pieces from other sources - I'll do my best to list them all.
