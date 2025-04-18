# ThinkPad Red LED Control Extension for GNOME

<p align="center">
  <img src="img/screenshot.png" alt="ThinkPad LED Control Screenshot">
</p>

This GNOME Shell extension allows you to control the red LED light on the back of ThinkPad laptops. With this extension, you can toggle between different LED states such as:

- **LED Off**
- **LED On**
- **LED Blinking** (with customizable blinking speeds in the future)

The extension interacts directly with the kernel to manage the LED states via commands that control the **ec_sys** module.

## Install

### GNOME Extensions Website

This extension is available on [GNOME Extensions Website](https://extensions.gnome.org/extension/7820/thinkpad-red-led/).

[![ThinkPad Thermal on extensions.gnome.org](img/ego.svg)](https://extensions.gnome.org/extension/7820/thinkpad-red-led/)

## Features
- **LED Control**: You can turn the LED on, off, or make it blink.
- **Morse Code Message**: You can input a text message, and the extension will flash the LED according to Morse code, providing a fun and functional way to communicate messages via the LED light.

## TODOs
- [x] **Give support to other Gnome Versions**: Give support to GNOME 47, 48
- [ ] **Support for Uppercase and Special Characters in Morse Code**: Currently, only lowercase letters and numbers are supported for Morse code. Uppercase letters and special characters need to be handled.
- [ ] **Add Persistence**: Resolve issues related with the state resetting after a reboot.
- [ ] **Add more languages**: Only english is supported righ now.
- [ ] **Interface to Control Morse Code Blinking Speed**: Implement a user interface to allow users to customize the speed of the Morse code blinking.

## How It Works
The extension modifies the state of the ThinkPad LED light through the **ec_sys** module in the Linux kernel. Depending on the command chosen (off, on, or blinking), the appropriate command is executed via `pkexec` to manage the LED state. 

The LED control relies on manipulating specific bits in the kernel I/O interface. For example:

- **LED On**: The state of the LED is represented by the **12th bit** being set to a certain value (`0x0A`).
- **LED Blinking**: This is controlled by modifying the **12th bit**, where it is set to `0x8A` for blinking.

Each state change directly manipulates this bit, causing the LED to behave according to the selected mode.

### Command Outputs

1. **LED Off**: When the LED is off, the `12th bit` is set to `0x8A`. Here's the corresponding command and output:

   **Command:**
   ```bash
   $ sudo hexdump -C /sys/kernel/debug/ec/ec0/io
   ```

   **Output:**
   ```
   00000000  e4 05 38 44 00 00 06 00  00 08 00 80 8a 01 80 00  |..8D............|
   ```

2. **LED Blinking**: When the LED is set to blink, the `12th bit` is set to `0xCA`. Here's the command and output:

   **Command:**
   ```bash
   $ sudo hexdump -C /sys/kernel/debug/ec/ec0/io
   ```

   **Output:**
   ```
   00000000  e4 05 38 44 00 00 06 00  00 08 00 80 ca 01 80 00  |..8D............|
   ```

3. **LED On**: When the LED is on, the `12th bit` is set to `0x0A`. Here's the command and output:

   **Command:**
   ```bash
   $ sudo hexdump -C /sys/kernel/debug/ec/ec0/io
   ```

   **Output:**
   ```
   00000000  e4 05 38 44 00 00 06 00  00 08 00 80 0a 01 80 00  |..8D............|
   ```



## Credits
- Special thanks to **vali20** for the idea on how to control the LED: [ThinkPad LED Control under GNU/Linux](https://www.reddit.com/r/thinkpad/comments/7n8eyu/thinkpad_led_control_under_gnulinux/)
- Special thanks to **c5e3** for the Morse code script: [Morse Code Script](https://gist.github.com/c5e3/e0264a546b249b635349f2ee6c302f36)

## Contributing
I welcome any contributions to improve this extension. Feel free to open pull requests with bug fixes or feature requests. Your contributions are greatly appreciated!

## License
This project is licensed under the MIT License.

