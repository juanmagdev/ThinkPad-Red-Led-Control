import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const HELPER_INSTALL_PATH = "/usr/local/bin/thinkpad-red-led-helper";
const SUDOERS_FILE = "/etc/sudoers.d/thinkpad-red-led";
const LOCKDOWN_STATUS_PATH = "/sys/kernel/security/lockdown";
const STATE_FILE_PATH = "/var/lib/thinkpad-red-led/state";
const MORSE_ALLOWED_RE = /^[0-9a-z ]+$/i;
const TEXT_DECODER = new TextDecoder('utf-8');


const LedControlMenu = GObject.registerClass(
class LedControlMenu extends QuickSettings.QuickMenuToggle {
    /**
     * Initializes the menu toggle for LED control.
     * This class manages the menu for controlling the LED state (on, off, blinking) within the GNOME Shell's quick settings.
     * 
     * @param {Object} extensionObject - The main extension object.
     * @param {Object} indicator - The indicator object for the menu.
     */
    _init(extensionObject, indicator) {
        super._init({
            title: _('Led Control'),
            subtitle: _('Led On'),
            iconName: 'keyboard-brightness-high-symbolic',
            toggleMode: true,
        });

        this._indicator = indicator;
        this.menu.setHeader('keyboard-brightness-high-symbolic', _('ThinkPad Red Led Control'), _(''));
        this._itemsSection = new PopupMenu.PopupMenuSection();
        this._menuItems = [
            { label: _('  Led Off  '), icon: 'keyboard-brightness-off-symbolic', action: 'off' },
            { label: _('  Led On  '), icon: 'keyboard-brightness-high-symbolic', action: 'on' },
            { label: _('  Led Blinking  '), icon: 'keyboard-brightness-medium-symbolic', action: 'blink' },
        ];

        this._menuItems.forEach((item, index) => {
            const menuItem = new PopupMenu.PopupBaseMenuItem();
            const box = new St.BoxLayout({ vertical: false, style_class: 'popup-menu-item-content' });
            const icon = new St.Icon({ icon_name: item.icon, style_class: 'popup-menu-icon' });
            box.add_child(icon);
            const label = new St.Label({ text: item.label, x_expand: true, x_align: Clutter.ActorAlign.START });
            box.add_child(label);
            const tick = new St.Icon({ icon_name: 'emblem-ok-symbolic', style_class: 'popup-menu-icon', visible: false });
            box.add_child(tick);
            menuItem._tick = tick;
            menuItem.actor.add_child(box);

            menuItem.connect('activate', () => {
                this._applyAction(index, menuItem);
            });
            
            this._itemsSection.addMenuItem(menuItem);
        });

        this.menu.addMenuItem(this._itemsSection);

        // Add a separator and settings action
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const setupItem = this.menu.addAction(_('Setup Helper'), () => this._openSetupDialog());
        setupItem.visible = Main.sessionMode.allowSettings;
        const morseItem = this.menu.addAction(_('Morse Message'), () => this._openMorseDialog());
        morseItem.visible = Main.sessionMode.allowSettings;
        
        this._currentCheckedIndex = 1;
        this._busy = false;
        this._applySavedState();
        this.connect('clicked', () => this._toggleFromButton());
    }

    /**
     * Runs a shell command asynchronously and checks its output.
     * @param {Array} command - The command to execute, passed as an array of strings.
     * @returns {Promise} Resolves if the command executes successfully, rejects otherwise.
     */
    _runCommand(command) {
        return new Promise((resolve, reject) => {
            try {
                let [success, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                    null,
                    command,
                    null,
                    GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null
                );

                if (!success) {
                    reject(new Error('Failed to start the command.'));
                    return;
                }

                // Read the output of the command
                let stdoutStream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stdout, close_fd: true }) });
                let stderrStream = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: stderr, close_fd: true }) });

                let output = "";
                let errorOutput = "";

                function readStream(stream, callback) {
                    stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
                        let [line, length] = source.read_line_finish(res);
                        if (line) {
                            let text = TEXT_DECODER.decode(line);
                            callback(text);
                            readStream(stream, callback);
                        }
                    });
                }

                readStream(stdoutStream, (text) => { output += text + "\n"; });
                readStream(stderrStream, (text) => { errorOutput += text + "\n"; });

                // Monitor the command's exit status
                GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, status) => {
                    try {
                        if (GLib.spawn_check_exit_status(status)) {
                            if (errorOutput.includes("Error executing command as another user: Request dismissed")) {
                                reject(new Error("User cancelled the authentication."));
                            } else {
                                resolve();
                            }
                        } else {
                            reject(new Error(`Command failed with status ${status}\n${errorOutput}`));
                        }
                    } catch (err) {
                        reject(err);
                    }
                });

            } catch (error) {
                console.error('Error running the command:', error);
                reject(error);
            }
        });
    }

    _notifySetupRequired() {
        Main.notify(_('Setup required'), _('Open "Setup Helper" and follow the steps to allow passwordless access.'));
    }

    _isAuthError(error) {
        const message = (error?.message || '').toLowerCase();
        return message.includes('sudo') && (
            message.includes('password') ||
            message.includes('not allowed') ||
            message.includes('permission denied') ||
            message.includes('no tty') ||
            message.includes('authentication')
        );
    }

    _getKernelLockdownMode() {
        try {
            if (!GLib.file_test(LOCKDOWN_STATUS_PATH, GLib.FileTest.IS_REGULAR)) {
                return null;
            }
            const [ok, contents] = GLib.file_get_contents(LOCKDOWN_STATUS_PATH);
            if (!ok || contents === null) {
                return null;
            }
            const text = TEXT_DECODER.decode(contents).trim();
            const match = text.match(/\[(\w+)\]/);
            if (!match) {
                return null;
            }
            const mode = match[1].toLowerCase();
            return mode === 'none' ? null : mode;
        } catch (error) {
            console.error('Error reading kernel lockdown status:', error);
            return null;
        }
    }

    _maybeNotifyLockdown() {
        const mode = this._getKernelLockdownMode();
        if (!mode) {
            return false;
        }
        Main.notify(
            _('Secure Boot / kernel lockdown'),
            _('Kernel lockdown is active (often due to Secure Boot). It blocks ec_sys write support, so the LED cannot be controlled. Disable Secure Boot or boot with lockdown=none.')
        );
        return true;
    }

    _runHelperCommand(args) {
        const sudoBin = GLib.find_program_in_path('sudo');
        if (!sudoBin) {
            Main.notify(_('Error'), _('sudo was not found on this system.'));
            const error = new Error('sudo not found');
            error.handled = true;
            return Promise.reject(error);
        }

        if (!GLib.file_test(HELPER_INSTALL_PATH, GLib.FileTest.IS_EXECUTABLE)) {
            this._notifySetupRequired();
            this._openSetupDialog();
            const error = new Error('helper not installed');
            error.handled = true;
            return Promise.reject(error);
        }

        return this._runCommand([sudoBin, '-n', HELPER_INSTALL_PATH, ...args]).catch((error) => {
            if (this._isAuthError(error)) {
                this._notifySetupRequired();
                this._openSetupDialog();
                error.handled = true;
            } else if (this._maybeNotifyLockdown()) {
                error.handled = true;
            }
            return Promise.reject(error);
        });
    }

    _readSavedState() {
        try {
            if (!GLib.file_test(STATE_FILE_PATH, GLib.FileTest.IS_REGULAR)) {
                return null;
            }
            const [ok, contents] = GLib.file_get_contents(STATE_FILE_PATH);
            if (!ok || contents === null) {
                return null;
            }
            const state = TEXT_DECODER.decode(contents).trim().toLowerCase();
            return state || null;
        } catch (error) {
            console.error('Error reading LED state file:', error);
            return null;
        }
    }

    _applySavedState() {
        const state = this._readSavedState();
        let index = null;
        if (state === 'off') index = 0;
        if (state === 'on') index = 1;
        if (state === 'blink') index = 2;

        if (index === null) {
            this._updateCheckState(this._currentCheckedIndex);
            return;
        }

        const item = this._menuItems[index];
        this._setState(index, item.icon, item.label.trim());
    }

    _applyAction(index, menuItem = null) {
        if (this._busy) {
            return;
        }

        const item = this._menuItems[index];
        if (!item) {
            return;
        }

        const previousIndex = this._currentCheckedIndex;
        const previousItem = this._menuItems[previousIndex];

        this._busy = true;
        this._setPendingState(item.icon, _('Applying...'));

        this._runHelperCommand([item.action]).then(() => {
            this._setState(index, item.icon, item.label.trim(), menuItem);
            this._busy = false;
        }).catch((error) => {
            if (!error?.handled) {
                Main.notify(_('Error'), _('Could not run the command.'));
            }
            console.error('Error running the command:', error);
            if (previousItem) {
                this._setState(previousIndex, previousItem.icon, previousItem.label.trim());
            }
            this._busy = false;
        });
    }

    _toggleFromButton() {
        const targetIndex = this._currentCheckedIndex === 0 ? 1 : 0;
        this._applyAction(targetIndex);
    }


    /**
     * Updates the check state of the menu items to indicate which option is currently active.
     * @param {number} checkedIndex - The index of the currently selected menu item.
     */
    _updateCheckState(checkedIndex) {
        this._currentCheckedIndex = checkedIndex;
        this.checked = this._currentCheckedIndex !== 0;
        this._itemsSection._getMenuItems().forEach((menuItem, index) => {
            menuItem._tick.visible = (index === this._currentCheckedIndex);
        });
        if (this._currentCheckedIndex === 0) super.subtitle = _('Led Off');
        if (this._currentCheckedIndex === 1) super.subtitle = _('Led On');
        if (this._currentCheckedIndex === 2) super.subtitle = _('Led Blinking');
    }

    _setState(index, iconName, label, menuItem = null) {
        this._updateCheckState(index);
        this.iconName = iconName;
        this.menu.setHeader(iconName, _('ThinkPad Red Led Control'), _(''));
        this._indicator.icon_name = iconName;
        super.subtitle = label;
        if (menuItem) {
            menuItem._tick.visible = true;
        }
    }

    _setPendingState(iconName, subtitle) {
        this.iconName = iconName;
        this.menu.setHeader(iconName, _('ThinkPad Red Led Control'), _(''));
        this._indicator.icon_name = iconName;
        super.subtitle = subtitle;
    }

    _openSetupDialog() {
        const STYLE_TITLE = 'font-weight: bold; font-size: 1.1em; margin-bottom: 8px;';
        const STYLE_SECTION = 'font-weight: bold; margin-top: 12px; margin-bottom: 4px; color: #3584e4;';
        const STYLE_TEXT = 'margin-bottom: 4px;';
        const STYLE_CODE_BOX = 'background-color: rgba(0,0,0,0.15); border-radius: 4px; padding: 6px 8px; margin: 2px 0;';
        const STYLE_CODE_LABEL = 'font-family: monospace;';
        const STYLE_COPY_BTN = 'padding: 2px 6px; margin-left: 8px;';
        const STYLE_NOTE = 'font-style: italic; color: #888; margin-top: 8px;';

        let dialog = new ModalDialog.ModalDialog({
            destroyOnClose: true,
            styleClass: 'my-dialog',
        });

        // Make dialog wider for better readability
        dialog.contentLayout.style = 'min-width: 850px;';

        let box = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'spacing: 2px;',
        });

        const addLabel = (text, style) => {
            let label = new St.Label({ text, x_align: Clutter.ActorAlign.START, style });
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            box.add_child(label);
        };

        const addCode = (text) => {
            let codeBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style: STYLE_CODE_BOX,
            });

            let label = new St.Label({
                text,
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
                style: STYLE_CODE_LABEL,
            });
            label.clutter_text.line_wrap = true;
            label.clutter_text.line_wrap_mode = Pango.WrapMode.CHAR;
            label.clutter_text.selectable = true;
            codeBox.add_child(label);

            let copyBtn = new St.Button({
                style_class: 'button',
                style: STYLE_COPY_BTN,
                child: new St.Icon({
                    icon_name: 'edit-copy-symbolic',
                    icon_size: 14,
                }),
            });
            copyBtn.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                // Visual feedback: change icon temporarily
                copyBtn.child.icon_name = 'emblem-ok-symbolic';
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    copyBtn.child.icon_name = 'edit-copy-symbolic';
                    return GLib.SOURCE_REMOVE;
                });
            });
            codeBox.add_child(copyBtn);

            box.add_child(codeBox);
        };

        // Title
        addLabel(_('This extension needs root access to control the ThinkPad LED.'), STYLE_TITLE);

        // Quick setup
        addLabel(_('Quick setup (recommended)'), STYLE_SECTION);
        addLabel(_('Installs helper, sudoers, and the systemd restore service.'), STYLE_TEXT);
        addCode('bash $HOME/.local/share/gnome-shell/extensions/thinkpad-red-led@juanmagd.dev/install.sh');

        // Manual setup
        addLabel(_('Manual setup'), STYLE_SECTION);
        addCode('EXT_SRC="$HOME/.local/share/gnome-shell/extensions/thinkpad-red-led@juanmagd.dev/tools/thinkpad-red-led-helper"');
        addCode(`sudo install -o root -g root -m 0755 "$EXT_SRC" ${HELPER_INSTALL_PATH}`);
        addCode(`sudo visudo -f ${SUDOERS_FILE}`);
        addLabel(_('Add this line (replace with your username):'), STYLE_TEXT);
        addCode(`your_user ALL=(root) NOPASSWD: ${HELPER_INSTALL_PATH}`);

        // Systemd service
        addLabel(_('Systemd service (boot restore)'), STYLE_SECTION);
        addCode('SERVICE_SRC="$HOME/.local/share/gnome-shell/extensions/thinkpad-red-led@juanmagd.dev/tools/thinkpad-red-led-restore.service"');
        addCode('sudo install -o root -g root -m 0644 "$SERVICE_SRC" /etc/systemd/system/thinkpad-red-led-restore.service');
        addCode('sudo systemctl daemon-reload');
        addCode('sudo systemctl enable thinkpad-red-led-restore.service');

        // System-wide note
        addLabel(_('If the extension is installed system-wide, use:'), STYLE_SECTION);
        addCode('EXT_SRC="/usr/share/gnome-shell/extensions/thinkpad-red-led@juanmagd.dev/tools/thinkpad-red-led-helper"');
        addCode('SERVICE_SRC="/usr/share/gnome-shell/extensions/thinkpad-red-led@juanmagd.dev/tools/thinkpad-red-led-restore.service"');

        addLabel(_('Then restart GNOME Shell or disable/enable the extension.'), STYLE_NOTE);

        dialog.contentLayout.add_child(box);

        dialog.addButton({
            label: _('Close'),
            action: () => {
                dialog.close(global.get_current_time());
            },
        });

        dialog.open(global.get_current_time());
    }


    /**
     * Opens a dialog window that allows the user to input text which will be converted to Morse code 
     * and used to control the LED in a Morse code pattern.
     * 
     * The user can input text and upon clicking "Accept", the text is sent to the privileged helper
     * which drives the LED on/off state to blink in Morse code.
     */
    _openMorseDialog() {
        let dialog = new ModalDialog.ModalDialog({
            destroyOnClose: true, 
            styleClass: 'my-dialog',
        });

        let contentLayout = dialog.contentLayout;

        let label = new St.Label({ text: _('Enter the text to emit in Morse (0-9, a-z, space):') });
        contentLayout.add_child(label);
    
        let entry = new St.Entry({ name: 'text-entry' });
        contentLayout.add_child(entry);
    
        dialog.addButton({
            label: _('Cancel'),
            action: () => {
                dialog.close(global.get_current_time()); 
            },
        });
    
        dialog.addButton({
            label: _('Accept'),
            action: () => {
                dialog.close(global.get_current_time());
                const rawText = entry.get_text();
                const morseText = rawText.trim().toLowerCase();

                if (!morseText) {
                    Main.notify(_('Error'), _('Please enter a message.'));
                    return;
                }

                if (!MORSE_ALLOWED_RE.test(morseText)) {
                    Main.notify(_('Error'), _('Only 0-9, a-z, and space are supported.'));
                    return;
                }

                const previousIndex = this._currentCheckedIndex;
                const previousIcon = this.iconName;
                this._setPendingState('keyboard-brightness-medium-symbolic', _('Morsing...'));

                this._runHelperCommand(['morse', morseText]).then(() => {
                    this._setState(1, 'keyboard-brightness-high-symbolic', _('Led On'));
                }).catch((error) => {
                    if (!error?.handled) {
                        Main.notify(_('Error'), _('Could not run the command.'));
                    }
                    console.error('Error running the command:', error);
                    const fallbackLabel = this._menuItems[previousIndex]?.label?.trim?.() || _('Led On');
                    this._setState(previousIndex, previousIcon, fallbackLabel);
                });
            },
        });

        dialog.open(global.get_current_time());
    }
});


/**
 * Creates an indicator in the GNOME Shell's quick settings panel. 
 * This indicator represents the LED control menu and allows interaction with it.
 * 
 * It adds an icon for the LED control and initializes the LED control menu to interact with the system.
 */
const LedControlIndicator = GObject.registerClass(
class LedControlIndicator extends QuickSettings.SystemIndicator {
    _init(extensionObject) {
        super._init();
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'keyboard-brightness-high-symbolic';
        this.quickSettingsItems.push(new LedControlMenu(extensionObject, this._indicator));
    }
});
    

/**
 * The main extension class that manages the activation and deactivation of the LED control extension.
 * 
 * When the extension is enabled, it adds the LED control indicator to the quick settings panel. 
 * When disabled, it removes the indicator and cleans up any associated resources.
 */
export default class LedControlExtension extends Extension {
    /**
     * Enables the extension and adds the LED control indicator to the GNOME Shell quick settings.
     */
    enable() {
        this._indicator = new LedControlIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }
    
    /**
     * Disables the extension and removes the LED control indicator from the quick settings.
     * Cleans up any resources associated with the indicator.
     */
    disable() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
    

