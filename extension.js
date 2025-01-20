import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const OFF_COMAND = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\x0a' | dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";
const ON_COMAND = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\x8a' | dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";
const BLINK_COMAND = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\xca' | dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";

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
            toggleMode: false,
        });

        this._indicator = indicator;
        this.menu.setHeader('keyboard-brightness-high-symbolic', _('ThinkPad Red Led Control'), _(''));
        this._itemsSection = new PopupMenu.PopupMenuSection();
        this._menuItems = [
            { label: _('  Led Off  '), icon: 'keyboard-brightness-off-symbolic', command: OFF_COMAND },
            { label: _('  Led On  '), icon: 'keyboard-brightness-high-symbolic', command: ON_COMAND },
            { label: _('  Led Blinking  '), icon: 'keyboard-brightness-medium-symbolic', command: BLINK_COMAND },
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
                this._runCommand([ 
                    "pkexec",
                    "bash",
                    "-c",
                    `${item.command}`
                ]).then(() => {
                        menuItem._tick.visible = true;
                        this._updateCheckState(index);
                        this.iconName = item.icon;
                        this.menu.setHeader(item.icon, _('ThinkPad Red Led Control'), _(''));
                        this._indicator.icon_name = item.icon;
                    
                }).catch((error) => {
                    Main.notify(_('Error'), _('Could not run the command. Check your credentials.'));
                    console.error('Error running the command:', error);
                });
            });
            
            this._itemsSection.addMenuItem(menuItem);
        });

        this.menu.addMenuItem(this._itemsSection);

        // Add a separator and settings action
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = this.menu.addAction(_('Mensaje en Morse'), () => this._openMorseDialog());
        settingsItem.visible = Main.sessionMode.allowSettings;
        
        // Would like to read the current state of the led, but it's not possible without root permissions
        this._currentCheckedIndex = 1;
        this._updateCheckState(this._currentCheckedIndex);
    }


    /**
     * Runs a shell command asynchronously.
     * @param {Array} command - The command to execute, passed as an array of strings.
     * @returns {Promise} A promise that resolves when the command executes successfully or rejects if it fails.
     */
    _runCommand(command) {
        return new Promise((resolve, reject) => {
            try {
                const [success, pid] = GLib.spawn_async(
                    null, 
                    command, 
                    null, 
                    GLib.SpawnFlags.SEARCH_PATH, 
                    null 
                );

                if (success) {
                    resolve();
                } else {
                    reject(new Error('Failed to run the command.'));
                }
            } catch (error) {
                console.error('Error running the command:', error);
                reject(error);
            }
        });
    }


    /**
     * Updates the check state of the menu items to indicate which option is currently active.
     * @param {number} checkedIndex - The index of the currently selected menu item.
     */
    _updateCheckState(checkedIndex) {
        this._currentCheckedIndex = checkedIndex;
        this._itemsSection._getMenuItems().forEach((menuItem, index) => {
            menuItem._tick.visible = (index === this._currentCheckedIndex);
        });
        if (this._currentCheckedIndex === 0) super.subtitle = _('Led Off');
        if (this._currentCheckedIndex === 1) super.subtitle = _('Led On');
        if (this._currentCheckedIndex === 2) super.subtitle = _('Led Blinking');
    }


    /**
     * Opens a dialog window that allows the user to input text which will be converted to Morse code 
     * and used to control the LED in a Morse code pattern.
     * 
     * The user can input text and upon clicking "Aceptar", the text is converted into a set of shell 
     * commands that control the LED's on/off state to blink in Morse code.
     */
    _openMorseDialog() {
        let dialog = new ModalDialog.ModalDialog({
            destroyOnClose: true, 
            styleClass: 'my-dialog',
        });

        let contentLayout = dialog.contentLayout;

        let label = new St.Label({ text: 'Enter the text to emit in Morse:' });
        contentLayout.add_child(label);
    
        let entry = new St.Entry({ name: 'text-entry' });
        contentLayout.add_child(entry);
    
        dialog.addButton({
            label: 'Cancel',
            action: () => {
                dialog.close(global.get_current_time()); 
            },
        });
    
        dialog.addButton({
            label: 'Acept',
            action: () => {
                const morseText = entry.get_text(); 
                log('Texto en Morse:', morseText);
        
                const morseCommands1 = `
                    modprobe -r ec_sys;
                    modprobe ec_sys write_support=1;
                    on='\\x8a';
                    off='\\x0a';
        
                    led() {
                        echo -n -e "$1" | dd of="/sys/kernel/debug/ec/ec0/io" bs=1 seek=12 count=1 conv=notrunc 2> /dev/null
                    }
        
                    dit() {
                        led $on;
                        sleep 0.3;
                        led $off;
                        sleep 0.15;
                    }
        
                    dah() {
                        led $on;
                        sleep 0.8;
                        led $off;
                        sleep 0.15;
                    }
        
                    morse() {
                        case "$1" in
                            "0") dah; dah; dah; dah; dah;;
                            "1") dit; dah; dah; dah; dah;;
                            "2") dit; dit; dah; dah; dah;;
                            "3") dit; dit; dit; dah; dah;;
                            "4") dit; dit; dit; dit; dah;;
                            "5") dit; dit; dit; dit; dit;;
                            "6") dah; dit; dit; dit; dit;;
                            "7") dah; dah; dit; dit; dit;;
                            "8") dah; dah; dah; dit; dit;;
                            "9") dah; dah; dah; dah; dit;;
                            "a") dit; dah;;
                            "b") dah; dit; dit; dit;;
                            "c") dah; dit; dah; dit;;
                            "d") dah; dit; dit;;
                            "e") dit;;
                            "f") dit; dit; dah; dit;;
                            "g") dah; dah; dit;;
                            "h") dit; dit; dit; dit;;
                            "i") dit; dit;;
                            "j") dit; dah; dah; dah;;
                            "k") dah; dit; dah;;
                            "l") dit; dah; dit; dit;;
                            "m") dah; dah;;
                            "n") dah; dit;;
                            "o") dah; dah; dah;;
                            "p") dit; dah; dah; dit;;
                            "q") dah; dah; dit; dah;;
                            "r") dit; dah; dit;;
                            "s") dit; dit; dit;;
                            "t") dah;;
                            "u") dit; dit; dah;;
                            "v") dit; dit; dit; dah;;
                            "w") dit; dah; dah;;
                            "x") dah; dit; dit; dah;;
                            "y") dah; dit; dah; dah;;
                            "z") dah; dah; dit; dit;;
                            " ") sleep 0.6;;
                        esac
                        sleep 0.2;
                    }
        
                     parse() {
                        tmp="\${1}";
                        for i in \$(seq 0 \${#tmp}); do
                            echo "current letter: \${tmp:\$i:1}";
                            morse \${tmp:\$i:1};
                        done;
                    }

                    led \$off;
                    parse "
                `;
                const morseCommands2 = `";
                    sleep 1;
                    led \$on;
                    modprobe -r ec_sys;`

                const morseCommands = morseCommands1 + morseText + morseCommands2;
        
                return new Promise((resolve, reject) => {
                    try {
                        this._runCommand([
                            "pkexec",
                            "bash",
                            "-c",
                            morseCommands
                        ]);
                        resolve(); 
                    } catch (error) {
                        console.error('Error running the command:', error);
                        reject(error);
                    }
                }).then(() => {
                    dialog.close(global.get_current_time());
                }).catch((error) => {
                    console.error('Error running the command:', error);
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
    



