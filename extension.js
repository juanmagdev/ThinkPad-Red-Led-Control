import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const COMANDO_APAGADO = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\x0a' | sudo dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";
const COMANDO_ENCENDIDO = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\x8a' | sudo dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";
const COMANDO_PARPADEO = "modprobe -r ec_sys && modprobe ec_sys write_support=1 && printf '\\xca' | sudo dd of=/sys/kernel/debug/ec/ec0/io bs=1 seek=12 count=1 conv=notrunc";

const ExampleMenuToggle = GObject.registerClass(
class ExampleMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(extensionObject) {
        super._init({
            title: _('Led Control'),
            subtitle: _('Led Encendido'),
            iconName: 'keyboard-brightness-high-symbolic',
            toggleMode: true,
        });

        // Add a header to the menu
        this.menu.setHeader('keyboard-brightness-high-symbolic', _('ThinkPad Red Led Control'), _(''));

        // Define menu items with icons
        this._itemsSection = new PopupMenu.PopupMenuSection();
        this._menuItems = [
            { label: _('  Led Apagado  '), icon: 'keyboard-brightness-off-symbolic', command: COMANDO_APAGADO },
            { label: _('  Led Encendido  '), icon: 'keyboard-brightness-high-symbolic', command: COMANDO_ENCENDIDO },
            { label: _('  Led Parpadeando  '), icon: 'keyboard-brightness-medium-symbolic', command: COMANDO_PARPADEO },
        ];

        // Create menu items with icons and add them to the menu
        this._menuItems.forEach((item, index) => {
            // Create a menu item
            const menuItem = new PopupMenu.PopupBaseMenuItem();

            // Create a box layout for the item content
            const box = new St.BoxLayout({ vertical: false, style_class: 'popup-menu-item-content' });

            // Add the icon to the left
            const icon = new St.Icon({ icon_name: item.icon, style_class: 'popup-menu-icon' });
            box.add_child(icon);

            // Add the label in the center
            const label = new St.Label({ text: item.label, x_expand: true, x_align: Clutter.ActorAlign.START });
            box.add_child(label);

            // Add a tick placeholder at the end (right)
            const tick = new St.Icon({ icon_name: 'emblem-ok-symbolic', style_class: 'popup-menu-icon', visible: false });
            box.add_child(tick);

            // Save a reference to the tick icon for later updates
            menuItem._tick = tick;

            // Add the custom layout to the menu item
            menuItem.actor.add_child(box);

            menuItem.connect('activate', () => {
                this._runCommand([
                    "pkexec",
                    "bash",
                    "-c",
                    `${item.command}`
                ]).then((result) => {
                    // Solo actualizamos el estado si el comando fue exitoso
                    menuItem._tick.visible = true;
                    this._updateCheckState(index);
                    this.iconName = item.icon;
                    this.menu.setHeader(item.icon, _('ThinkPad Red Led Control'), _(''));
                    this._indicator.icon_name = item.icon;
                }).catch((error) => {
                    // Notificar al usuario sobre el error
                    Main.notify(_('Error'), _('No se pudo ejecutar el comando. Verifica tus credenciales.'));
                });
            });
            

            this._itemsSection.addMenuItem(menuItem);
        });

        this.menu.addMenuItem(this._itemsSection);

        // Add a separator and settings action
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = this.menu.addAction(_('Mensaje en Morse'), () => this._openMorseDialog());
        settingsItem.visible = Main.sessionMode.allowSettings;
        
        // Initialize check states
        // Habria que leer el estado del led para saber cual esta activo, pero como hago esto sin sudo?
        this._currentCheckedIndex = 1;
        this._updateCheckState(this._currentCheckedIndex);
    }

    _runCommand(command) {
        return new Promise((resolve, reject) => {
            try {
                let [success, stdout, stderr, exitCode] = GLib.spawn_sync(
                    null,    // Current working directory
                    command, // Command to run
                    null,    // Environment variables
                    GLib.SpawnFlags.SEARCH_PATH, // Search in $PATH
                    null     // Child setup function
                );
    
                if (success && exitCode === 0) {
                    resolve(stdout.toString());
                } else {
                    console.error("Error executing command:", stderr.toString());
                    reject(new Error(stderr.toString()));
                }
            } catch (error) {
                console.error("Spawn failed:", error);
                reject(error);
            }
        });
    }
    
    
    _updateCheckState(checkedIndex) {
        this._currentCheckedIndex = checkedIndex;
        this._itemsSection._getMenuItems().forEach((menuItem, index) => {
            menuItem._tick.visible = (index === this._currentCheckedIndex);
        });
        if (this._currentCheckedIndex === 0) super.subtitle = _('Led Apagado');
        if (this._currentCheckedIndex === 1) super.subtitle = _('Led Encendido');
        if (this._currentCheckedIndex === 2) super.subtitle = _('Led Parpadeando');
    }

    _openMorseDialog() {
        // Crear el diálogo modal
        let dialog = new ModalDialog.ModalDialog({
            destroyOnClose: true, // Cerrar el diálogo al destruirlo
            styleClass: 'my-dialog', // Puedes agregar tu propio estilo si lo necesitas
        });
    
        // Crear el área de contenido del diálogo
        let contentLayout = dialog.contentLayout;
    
        // Etiqueta con la descripción
        let label = new St.Label({ text: 'Ingrese el texto a emitir en Morse:' });
        contentLayout.add_child(label);
    
        // Crear un campo de texto para que el usuario ingrese el mensaje
        let entry = new St.Entry({ name: 'text-entry' });
        contentLayout.add_child(entry);
    
        // Agregar botones de acción
        dialog.addButton({
            label: 'Cancelar',
            action: () => {
                dialog.close(global.get_current_time()); // Cerrar el diálogo sin hacer nada
            },
        });
    
        dialog.addButton({
            label: 'Aceptar',
            action: () => {
                const morseText = entry.get_text();  // Obtener el texto ingresado
                log('Texto en Morse:', morseText);
        
                // Comando completo a ejecutar con pkexec
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
                log('Comandos en Morse:', morseCommands);
        
                // Ejecutar todo el bloque de comandos con pkexec
                return new Promise((resolve, reject) => {
                    try {
                        this._runCommand([
                            "pkexec",
                            "bash",
                            "-c",
                            morseCommands // Todo el bloque de comandos aquí
                        ]);
                        resolve(); // Resolvemos la promesa si el comando se ejecutó sin errores
                    } catch (error) {
                        reject(error); // Rechazamos la promesa si hubo algún error
                    }
                }).then(() => {
                    dialog.close(global.get_current_time()); // Cerrar el diálogo
                }).catch((error) => {
                    console.error("Error ejecutando el comando:", error);
                });
            },
        });
        
        // Mostrar el diálogo
        dialog.open(global.get_current_time());
        
    }
    
});

const ExampleIndicator = GObject.registerClass(
class ExampleIndicator extends QuickSettings.SystemIndicator {
    _init(extensionObject) {
        super._init();

        // Create an indicator icon
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'keyboard-brightness-high-symbolic';

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

