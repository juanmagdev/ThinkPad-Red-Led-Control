import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const COMANDO_APAGADO =  "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\x0a' | sudo dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";
const COMANDO_ENCENDIDO = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\x8a' | sudo dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";
const COMANDO_PARPADEO =   "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\xca' | sudo dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";

const ExampleMenuToggle = GObject.registerClass(
class ExampleMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(extensionObject) {
        super._init({
            title: _('Led Control'),
            iconName: 'circle-filled-symbolic',
            toggleMode: true,
        });

        // Add a header to the menu
        this.menu.setHeader('circle-filled-symbolic', _('ThinkPad Red Led Control'), _(''));

        // Create menu items
        this._itemsSection = new PopupMenu.PopupMenuSection();
        this._menuItems = [
            { label: _('Led Apagado'), command: COMANDO_APAGADO },
            { label: _('Led Encendido'), command: COMANDO_ENCENDIDO },
            { label: _('Led Parpadeando'), command: COMANDO_PARPADEO },
        ];

        this._menuItems.forEach((item, index) => {
            const menuItem = new PopupMenu.PopupMenuItem(item.label);
            menuItem.connect('activate', () => {
                this._runCommand([
                    "pkexec",
                    "bash",
                    "-c",
                    `${item.command}`
                ]);
                this._updateCheckState(index);
            });
            this._itemsSection.addMenuItem(menuItem);
        });

        this.menu.addMenuItem(this._itemsSection);

        // Add a separator and settings action
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = this.menu.addAction(_('Mensaje en Morse'), () => extensionObject.openPreferences());
        settingsItem.visible = Main.sessionMode.allowSettings;

        // Initialize check states
        this._currentCheckedIndex = null;
        this._updateCheckState(-1);
    }

    _runCommand(command) {
        console.log('Running command:', command);
        GLib.spawn_async(null, command, null, GLib.SpawnFlags.SEARCH_PATH, null);
    }

    _updateCheckState(checkedIndex) {
        this._currentCheckedIndex = checkedIndex;
        this._itemsSection._getMenuItems().forEach((menuItem, index) => {
            menuItem.setOrnament(
                index === this._currentCheckedIndex
                    ? PopupMenu.Ornament.CHECK
                    : PopupMenu.Ornament.NONE
            );
        });
    }
});

const ExampleIndicator = GObject.registerClass(
class ExampleIndicator extends QuickSettings.SystemIndicator {
    _init(extensionObject) {
        super._init();

        // Create an indicator icon
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'circle-filled-symbolic';

        // Add the toggle to the quick settings menu
        this.quickSettingsItems.push(new ExampleMenuToggle(extensionObject));
    }
});

export default class QuickSettingsExampleExtension extends Extension {
    enable() {
        this._indicator = new ExampleIndicator(this);

        // Add the indicator to the quick settings menu
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
