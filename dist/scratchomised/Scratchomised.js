// TODO : add functions for the protocol, plus a function to filter objects

// Class representing the extension
class Scratchomised {
    constructor(runtime) {
        this.runtime = runtime;
        this.port = 80; // Valeur par défaut (peut être surchargée par une variable Scratch)
        this.server = "127.0.0.1"; // Valeur par défaut (localhost)
        this.protocol = "ws"; // Toujours "ws" pour WebSocket
        this.socket = null;
        this._reconnectSocket();
        this._objects = {};
        // État bi-stable des interrupteurs côté Scratch (toggle à chaque clic)
        // key: id SH3D (ex: pieceOfFurniture-...), value: boolean
        this._switchStates = {};
        // Ancien mécanisme (impulsion) conservé uniquement pour compatibilité interne / debug
        this._clickedSwitches = {};
        this._switchClickedOpcodes = {}; // Map opcode -> switch id (nom(description)) pour les blocs "un bloc par objet"
        this._observerX = 0; // Position X de l'Observer dans la vue 2D de SweetHome3D (coordonnées Scratch)
        this._observerY = 0; // Position Y de l'Observer dans la vue 2D de SweetHome3D (coordonnées Scratch)
        this._observerDirection = 90; // Direction de l'Observer (en degrés Scratch, 90 = vers le haut)
        this._svgWidth = 480; // Largeur du SVG exporté
        this._svgHeight = 360; // Hauteur du SVG exporté
        this._observerSprite = null; // Référence au sprite Observer dans Scratch
        this._prefix = "[Scratchomised] - ";
        this._menuVersion = 0; // Compteur pour forcer le rafraîchissement des menus
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 10;
        this._reconnectDelay = 1000; // Délai initial de 1 seconde
        this._shouldReconnect = true;
        this._debugMode = false; // Mode debug pour réduire les logs en production
        this._receivedObjectsOnce = false; // True dès qu'on reçoit update_objects au moins une fois
        this._clientReadyRetryTimer = null; // Timer de retry client_ready
        // Détecter la langue (français ou anglais par défaut)
        try {
            const lang = (typeof navigator !== 'undefined' && navigator.language) 
                ? navigator.language.substring(0, 2).toLowerCase() 
                : 'en';
            this._locale = (lang === 'fr') ? 'fr' : 'en';
        } catch (e) {
            this._locale = 'en';
        }
    }

    _getStageTarget() {
        try {
            if (this.runtime) {
                if (typeof this.runtime.getTargetForStage === "function") return this.runtime.getTargetForStage();
                if (Array.isArray(this.runtime.targets)) return this.runtime.targets.find(t => t && t.isStage);
            }
        } catch (e) {}
        return null;
    }

    _getScratchVarById(varId) {
        // Prefer global (Stage) vars so user can edit them from any sprite (catégorie Variables)
        const stage = this._getStageTarget();
        if (stage && stage.lookupVariableById) {
            try {
                const v = stage.lookupVariableById(varId);
                if (v) return v;
            } catch (e) {}
        }
        // Fallback to Observer sprite vars
        const sprite = this._getObserverSprite(false);
        if (sprite && sprite.lookupVariableById) {
            try {
                const v = sprite.lookupVariableById(varId);
                if (v) return v;
            } catch (e) {}
        }
        return null;
    }

    _getServerConfigFromVariables() {
        const addrVar = this._getScratchVarById("ScratchomisedServerAddressVar");
        const portVar = this._getScratchVarById("ScratchomisedServerPortVar");
        const server = addrVar ? String(addrVar.value ?? "").trim() : "";
        const portRaw = portVar ? portVar.value : null;
        const portNum = (portRaw === null || portRaw === undefined || portRaw === "") ? NaN : parseInt(portRaw, 10);
        return {
            server: server || null,
            port: Number.isFinite(portNum) ? portNum : null
        };
    }

    /**
     * Génère un opcode stable et "safe" pour un interrupteur (pour créer un bloc sans argument monitorable).
     * On utilise un hash simple pour éviter les opcodes trop longs.
     */
    _makeSwitchClickedOpcode(switchId) {
        const str = String(switchId || "");
        // djb2 hash
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash |= 0; // force 32-bit
        }
        // opcode doit être une clé JS valide
        return "isSwitchClicked__" + (hash >>> 0).toString(16);
    }

    _parseExportEntry(entry) {
        const s = String(entry ?? "");
        const idx = s.indexOf("|");
        if (idx === -1) {
            return {id: s, label: s};
        }
        return {
            id: s.substring(0, idx),
            label: s.substring(idx + 1)
        };
    }

    _makeHashedOpcode(prefix, key) {
        const str = String(key || "");
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return prefix + "__" + (hash >>> 0).toString(16);
    }

    _normalizeObjectId(value) {
        const s = String(value ?? "");
        const idx = s.indexOf("|");
        if (idx === -1) return s;
        return s.substring(0, idx);
    }

    _getExportedListValues(listId) {
        const sprite = this._getObserverSprite();
        if (!sprite || !sprite.lookupVariableById) return null;
        try {
            const listVar = sprite.lookupVariableById(listId);
            if (listVar && Array.isArray(listVar.value)) {
                return listVar.value;
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    _buildStaticMenuFromExportedList(listId, filterFn = null) {
        const values = this._getExportedListValues(listId);
        if (!values || values.length === 0) return null;
        const items = [];
        for (const entry of values) {
            const parsed = this._parseExportEntry(entry);
            if (filterFn && !filterFn(parsed)) continue;
            items.push({
                text: parsed.label,
                value: parsed.id
            });
        }
        return items.length ? items : null;
    }

    // Helper pour obtenir le texte traduit
    _t(texts) {
        if (typeof texts === 'string') {
            return texts;
        }
        return texts[this._locale] || texts['en'] || Object.values(texts)[0];
    }

    // Constantes pour les valeurs par défaut
    static DEFAULT_SVG_WIDTH = 480;
    static DEFAULT_SVG_HEIGHT = 360;
    static DEFAULT_OBSERVER_DIRECTION = 90;
    static MAX_RECONNECT_DELAY = 30000; // 30 secondes maximum

    // Helper pour logger uniquement si le mode debug est activé
    _debugLog(message, level = 'log') {
        if (this._debugMode) {
            if (level === 'error') {
                console.error(this._prefix + message);
            } else if (level === 'warn') {
                console.warn(this._prefix + message);
            } else {
                console.log(this._prefix + message);
            }
        }
    }

    // Helper pour les messages de liste vide traduits
    _getEmptyListMessage(type) {
        const messages = {
            objects: { en: "[no objects]", fr: "[aucun objet]" },
            lights: { en: "[no lights]", fr: "[aucune lumière]" },
            switches: { en: "[no switches]", fr: "[aucun interrupteur]" }
        };
        return [this._t(messages[type] || messages.objects)];
    }


    // Trouver le sprite Observer dans Scratch (comme dans ScratchHome2.0)
    _getObserverSprite(forceRefresh = false) {
        if (forceRefresh) {
            this._observerSprite = null;
        }
        if (!this._observerSprite) {
            try {
                // Chercher le sprite nommé "Observer" dans le runtime
                if (this.runtime && this.runtime.getSpriteTargetByName) {
                    this._observerSprite = this.runtime.getSpriteTargetByName("Observer");
                    if (this._observerSprite) {
                        this._debugLog("Observer sprite found");
                    } else {
                        this._debugLog("Observer sprite not found - make sure the sprite is named 'Observer'", 'warn');
                    }
                }
            } catch (error) {
                console.error(this._prefix + "Error getting Observer sprite: " + error);
            }
        }
        return this._observerSprite;
    }

    // Mettre à jour la position du sprite Observer
    _updateObserverSpritePosition() {
        const sprite = this._getObserverSprite();
        if (sprite && sprite.setXY) {
            try {
                sprite.setXY(this._observerX, this._observerY);
                if (sprite.setDirection && this._observerDirection !== undefined) {
                    // Normaliser la direction pour s'assurer qu'elle est dans la plage 0-360
                    let direction = this._observerDirection;
                    if (!isFinite(direction)) {
                        direction = Scratchomised.DEFAULT_OBSERVER_DIRECTION;
                    }
                    direction = ((direction % 360) + 360) % 360;
                    sprite.setDirection(direction);
                }
                this._debugLog("Observer sprite position updated: X=" + this._observerX + ", Y=" + this._observerY + ", Direction=" + this._observerDirection);
            } catch (error) {
                console.error(this._prefix + "Error updating Observer sprite position: " + error);
            }
        }
    }

    // Mettre à jour les coordonnées de l'Observer à partir des arguments d'un message
    _updateObserverCoordinates(args) {
        if (!args) return;
        
        if (args.observerX !== undefined) {
            // Arrondir à 2 chiffres après la virgule
            this._observerX = Math.round(parseFloat(args.observerX) * 100) / 100 || 0;
            this._debugLog("Observer X updated to: " + this._observerX);
        }
        if (args.observerY !== undefined) {
            // Arrondir à 2 chiffres après la virgule
            this._observerY = Math.round(parseFloat(args.observerY) * 100) / 100 || 0;
            this._debugLog("Observer Y updated to: " + this._observerY);
        }
        if (args.observerDirection !== undefined) {
            // ScratchHome2.0 mapping: on utilise directement la direction fournie par le plugin
            // (déjà convertie en degrés Scratch côté plugin).
            let direction = parseFloat(args.observerDirection);
            if (!isFinite(direction)) direction = Scratchomised.DEFAULT_OBSERVER_DIRECTION;
            direction = ((direction % 360) + 360) % 360;
            this._observerDirection = direction;
            this._debugLog("Observer Direction updated to: " + this._observerDirection);
        }
        if (args.svgWidth !== undefined) {
            this._svgWidth = parseFloat(args.svgWidth) || Scratchomised.DEFAULT_SVG_WIDTH;
        }
        if (args.svgHeight !== undefined) {
            this._svgHeight = parseFloat(args.svgHeight) || Scratchomised.DEFAULT_SVG_HEIGHT;
        }
        
        // Mettre à jour la position du sprite Observer en temps réel
        this._updateObserverSpritePosition();
    }

    // Give informations to Scratch about the extension
    getInfo() {
        // Obtenir les blocs dynamiquement selon la variable typeBlocks
        const blocks = this.getBlocks();

        // Si le SB3 exporté contient les listes object/lamp, construire des menus STATIQUES (sandbox-friendly)
        const OBJECT_LIST_ID = "CNn7j*SP0QT%rN4=j[xz";
        const LAMP_LIST_ID = "GoN|030ruZ,{H+4$)C-$";
        const exportedObjectsMenu = this._buildStaticMenuFromExportedList(OBJECT_LIST_ID);
        const exportedLampsMenu = this._buildStaticMenuFromExportedList(LAMP_LIST_ID);
        const exportedSwitchesMenu = this._buildStaticMenuFromExportedList(
            OBJECT_LIST_ID,
            (p) => {
                const lower = (p.label || "").toLowerCase();
                return lower.includes("switch") || lower.includes("interrupteur");
            }
        );
        
        return {
            // Identifier of the extension (unique)
            id: "scratchomised",

            // Name of the extension, as shown in Scratch
            name: "Scratchomised",

            // Blocks shown in Scratch
            blocks: blocks,

            // Define the extension's menus
            menus: {

                // "Properties" menu
                // It is a static menu
                properties: {
                    // Menu elements
                    items: "getProperties"
                },
                objects: {
                    // The menu "object" is a dynamic menu
                    // Instead of giving an array, the name of a function is given
                    // This function will be called each time the menu is opened
                    // It will return an array containing the menu's elements
                    //
                    // /!\ WARNING /!\
                    // Due to a strange behaviour of the TurboWarp VM, dynamic menus only works
                    // in unsandboxed extensions
                    items: exportedObjectsMenu || "getObjects"
                },
                objectsPowerableLights: {
                    items: exportedLampsMenu || "getObjectsPowerableLights"
                },
                objectsSwitches: {
                    items: exportedSwitchesMenu || "getObjectsSwitches"
                }
            }
        }
    }

    /**
     * Retourne les blocs à afficher selon la variable typeBlocks dans le sprite Observer
     * Si typeBlocks = "blocksSimples", crée un bloc pour chaque objet au lieu d'utiliser des menus
     */
    getBlocks() {
        // Initialiser avec les blocs de base (avec menus déroulants)
        let result = [
                // -- HAT BLOCKS (Events) --
                {
                    opcode: "whenPropertyIs",
                    blockType: "hat",
                    text: this._t({
                        en: "when [OBJECT] is [VALUE]",
                        fr: "quand [OBJECT] est [VALUE]"
                    }),
                    arguments: {
                        OBJECT: {
                            type: "string",
                            menu: "objects"
                        },
                        VALUE: {
                            type: "Boolean"
                        }
                    }
                },
                // -- COMMAND BLOCKS (Actions) --
                {
                    opcode: "setLightState",
                    blockType: "command",
                    text: this._t({
                        en: "set [LIGHT] to [STATE]",
                        fr: "mettre [LIGHT] à [STATE]"
                    }),
                    arguments: {
                        STATE: {
                            type: "Boolean"
                        },
                        LIGHT: {
                            type: "string",
                            menu: "objectsPowerableLights"
                        }
                    }
                },
                {
                    opcode: "objectsLightsTurnOn",
                    blockType: "command",
                    text: this._t({
                        en: "turn on [POWERABLE_LIGHT]",
                        fr: "allumer [POWERABLE_LIGHT]"
                    }),
                    arguments: {
                        POWERABLE_LIGHT: {
                            type: "string",
                            menu: "objectsPowerableLights"
                        }
                    }
                },
                {
                    opcode: "objectsLightsTurnOff",
                    blockType: "command",
                    text: this._t({
                        en: "turn off [POWERABLE_LIGHT]",
                        fr: "éteindre [POWERABLE_LIGHT]"
                    }),
                    arguments: {
                        POWERABLE_LIGHT: {
                            type: "string",
                            menu: "objectsPowerableLights"
                        }
                    }
                },
                {
                    opcode: "connectToServer",
                    blockType: "command",
                    text: this._t({
                        en: "connect to server [SERVER] with port [PORT]",
                        fr: "se connecter au serveur [SERVER] sur le port [PORT]"
                    }),
                    arguments: {
                        SERVER: {
                            type: "string"
                        },
                        PORT: {
                            type: "number"
                        }
                    }
                },
                {
                    opcode: "reconnectToServer",
                    blockType: "command",
                    text: this._t({
                        en: "reconnect to the current server",
                        fr: "reconnecter au serveur actuel"
                    })
                },
                {
                    opcode: "resetExtension",
                    blockType: "command",
                    text: this._t({
                        en: "reset extension",
                        fr: "réinitialiser l'extension"
                    })
                },
                // -- BOOLEAN BLOCKS --
                {
                    opcode: "isLightOn",
                    blockType: "Boolean",
                    text: this._t({
                        en: "on",
                        fr: "allumé"
                    }),
                    disableMonitor: true
                },
                {
                    opcode: "isLightOff",
                    blockType: "Boolean",
                    text: this._t({
                        en: "off",
                        fr: "éteint"
                    }),
                    disableMonitor: true
                },
                {
                    opcode: "isSwitchClicked",
                    blockType: "Boolean",
                    text: this._t({
                        en: "[SWITCH] is clicked",
                        fr: "[SWITCH] est cliqué"
                    }),
                    arguments: {
                        SWITCH: {
                            type: "string",
                            menu: "objectsSwitches"
                        }
                    }
                },
                {
                    opcode: "isConnectedToServer",
                    blockType: "Boolean",
                    text: this._t({
                        en: "is connected to server?",
                        fr: "est connecté au serveur ?"
                    }),
                    disableMonitor: false
                },
                // NOTE: "adresse/port du serveur" sont maintenant des variables Scratch standard (catégorie Variables),
                // donc on ne les duplique plus ici dans la catégorie Scratchomised.
                {
                    opcode: "getObjectsCount",
                    blockType: "reporter",
                    text: this._t({
                        en: "number of objects",
                        fr: "nombre d'objets"
                    }),
                    disableMonitor: false
                },
                {
                    opcode: "getObserverX",
                    blockType: "reporter",
                    text: this._t({
                        en: "observer X",
                        fr: "observateur X"
                    }),
                    disableMonitor: false
                },
                {
                    opcode: "getObserverY",
                    blockType: "reporter",
                    text: this._t({
                        en: "observer Y",
                        fr: "observateur Y"
                    }),
                    disableMonitor: false
                },
                {
                    opcode: "getObserverDirection",
                    blockType: "reporter",
                    text: this._t({
                        en: "observer direction",
                        fr: "direction observateur"
                    }),
                    disableMonitor: false
                }
            ];

        // Vérifier si le sprite Observer existe et si la variable typeBlocks existe
        const sprite = this._getObserverSprite();
        if (sprite && sprite.lookupVariableById) {
            try {
                const typeBlocksVar = sprite.lookupVariableById("L^i{fNhE#uQ8.g=D;O~O");
                if (typeBlocksVar && typeBlocksVar.value && typeBlocksVar.value.startsWith("b")) {
                    // typeBlocks = "blocksSimples" -> créer des blocs individuels pour chaque objet
                    result = [];
                    
                    // Obtenir les listes d'objets
                    const objectList = sprite.lookupVariableById("CNn7j*SP0QT%rN4=j[xz");
                    const lampList = sprite.lookupVariableById("GoN|030ruZ,{H+4$)C-$");
                    
                    // En mode "un bloc par objet", générer des blocs dédiés (sans menus) qui appellent
                    // les mêmes fonctions que le mode menus, mais avec l'id interne SH3D hardcodé.
                    if (lampList && lampList.value && Array.isArray(lampList.value)) {
                        for (let lampEntry of lampList.value) {
                            const parsed = this._parseExportEntry(lampEntry);
                            const lampId = parsed.id;
                            const lampLabel = parsed.label;

                            // Hat: "quand <lampe> est [VALUE]"
                            const whenLampOpcode = this._makeHashedOpcode("whenLampIs", lampId);
                            if (typeof this[whenLampOpcode] !== "function") {
                                this[whenLampOpcode] = (args) => this.whenPropertyIs({OBJECT: lampId, VALUE: args.VALUE});
                            }
                            result.push({
                                opcode: whenLampOpcode,
                                blockType: "hat",
                                text: this._t({
                                    en: "when " + lampLabel + " is [VALUE]",
                                    fr: "quand " + lampLabel + " est [VALUE]"
                                }),
                                arguments: {
                                    VALUE: { type: "Boolean" }
                                }
                            });

                            // Command: "mettre <lampe> à [STATE]"
                            const setLampOpcode = this._makeHashedOpcode("setLampState", lampId);
                            if (typeof this[setLampOpcode] !== "function") {
                                this[setLampOpcode] = (args) => this.setLightState({LIGHT: lampId, STATE: args.STATE});
                            }
                            result.push({
                                opcode: setLampOpcode,
                                blockType: "command",
                                text: this._t({
                                    en: "set " + lampLabel + " to [STATE]",
                                    fr: "mettre " + lampLabel + " à [STATE]"
                                }),
                                arguments: {
                                    STATE: { type: "Boolean" }
                                }
                            });

                            // Command: "allumer <lampe>"
                            const onLampOpcode = this._makeHashedOpcode("turnOnLamp", lampId);
                            if (typeof this[onLampOpcode] !== "function") {
                                this[onLampOpcode] = () => this.objectsLightsTurnOn({POWERABLE_LIGHT: lampId});
                            }
                            result.push({
                                opcode: onLampOpcode,
                                blockType: "command",
                                text: this._t({
                                    en: "turn on " + lampLabel,
                                    fr: "allumer " + lampLabel
                                })
                            });

                            // Command: "éteindre <lampe>"
                            const offLampOpcode = this._makeHashedOpcode("turnOffLamp", lampId);
                            if (typeof this[offLampOpcode] !== "function") {
                                this[offLampOpcode] = () => this.objectsLightsTurnOff({POWERABLE_LIGHT: lampId});
                            }
                            result.push({
                                opcode: offLampOpcode,
                                blockType: "command",
                                text: this._t({
                                    en: "turn off " + lampLabel,
                                    fr: "éteindre " + lampLabel
                                })
                            });
                        }
                    }

                    // Ajouter les autres blocs (connexion, etc.) - pas de duplication
                    result.push({
                        opcode: "connectToServer",
                        blockType: "command",
                        text: this._t({
                            en: "connect to server [SERVER] with port [PORT]",
                            fr: "se connecter au serveur [SERVER] sur le port [PORT]"
                        }),
                        arguments: {
                            SERVER: {
                                type: "string"
                            },
                            PORT: {
                                type: "number"
                            }
                        }
                    });
                    result.push({
                        opcode: "reconnectToServer",
                        blockType: "command",
                        text: this._t({
                            en: "reconnect to the current server",
                            fr: "reconnecter au serveur actuel"
                        })
                    });
                    result.push({
                        opcode: "resetExtension",
                        blockType: "command",
                        text: this._t({
                            en: "reset extension",
                            fr: "réinitialiser l'extension"
                        })
                    });
                    result.push({
                        opcode: "isLightOn",
                        blockType: "Boolean",
                        text: this._t({
                            en: "on",
                            fr: "allumé"
                        }),
                        disableMonitor: true
                    });
                    result.push({
                        opcode: "isLightOff",
                        blockType: "Boolean",
                        text: this._t({
                            en: "off",
                            fr: "éteint"
                        }),
                        disableMonitor: true
                    });

                    // Mettre les blocs interrupteurs JUSTE AU-DESSUS de "est connecté au serveur ?"
                    // donc entre "éteint" et "est connecté au serveur ?"
                    // IMPORTANT: pour avoir la "case à cocher" (watcher), on génère un bloc SANS argument par interrupteur.
                    if (objectList && objectList.value && Array.isArray(objectList.value)) {
                        for (let objEntry of objectList.value) {
                            const parsed = this._parseExportEntry(objEntry);
                            const objId = parsed.id;
                            const objLabel = parsed.label;
                            const lower = objLabel.toLowerCase();
                            if (lower.includes("switch") || lower.includes("interrupteur")) {
                                const opcode = this._makeHashedOpcode("isSwitchClicked", objId);
                                this._switchClickedOpcodes[opcode] = objId;
                                if (typeof this[opcode] !== "function") {
                                    this[opcode] = () => this.isSwitchClicked({SWITCH: objId});
                                }
                                result.push({
                                    opcode: opcode,
                                    blockType: "Boolean",
                                    text: this._t({
                                        en: objLabel + " is clicked ?",
                                        fr: objLabel + " est cliqué ?"
                                    }),
                                    disableMonitor: false
                                });
                            }
                        }
                    }

                    result.push({
                        opcode: "isConnectedToServer",
                        blockType: "Boolean",
                        text: this._t({
                            en: "is connected to server?",
                            fr: "est connecté au serveur ?"
                        }),
                        disableMonitor: false
                    });
                    // NOTE: "adresse/port du serveur" sont des variables Scratch standard, pas des blocks Scratchomised.
                    result.push({
                        opcode: "getObjectsCount",
                        blockType: "reporter",
                        text: this._t({
                            en: "number of objects",
                            fr: "nombre d'objets"
                        }),
                        disableMonitor: false
                    });
                    result.push({
                        opcode: "getObserverX",
                        blockType: "reporter",
                        text: this._t({
                            en: "observer X",
                            fr: "observateur X"
                        }),
                        disableMonitor: false
                    });
                    result.push({
                        opcode: "getObserverY",
                        blockType: "reporter",
                        text: this._t({
                            en: "observer Y",
                            fr: "observateur Y"
                        }),
                        disableMonitor: false
                    });
                    result.push({
                        opcode: "getObserverDirection",
                        blockType: "reporter",
                        text: this._t({
                            en: "observer direction",
                            fr: "direction observateur"
                        }),
                        disableMonitor: false
                    });
                }
            } catch (error) {
                this._debugLog("Error reading typeBlocks variable: " + error, 'warn');
                // En cas d'erreur, utiliser les blocs par défaut avec menus
            }
        }
        
        return result;
    }

    whenPropertyIs(args) {
        try {
            // Valider les arguments
            if (!args || !args.OBJECT) {
                this._debugLog("whenPropertyIs: missing OBJECT argument", 'warn');
                return false;
            }

            const objectId = this._normalizeObjectId(args.OBJECT);
            
            // Vérifier si l'objet existe et si sa propriété "color" correspond à la valeur boolean
            if (this._objects[objectId]) {
                const obj = this._objects[objectId];
                const value = Boolean(args.VALUE);
                
                if (value) {
                    // Si la valeur est true, vérifier si la couleur est jaune (0xFFFF00 ou -256) = allumé
                    return obj.color === 16776960 || obj.color === -256 || obj.color === 0xFFFF00;
                } else {
                    // Si la valeur est false, vérifier si la couleur est null ou absente (éteint)
                    return obj.color == null || obj.color === undefined;
                }
            }
            return false;
        } catch (error) {
            console.error(this._prefix + "error in whenPropertyIs: " + error);
            return false;
        }
    }

    setLightState(args) {
        try {
            // Valider les arguments
            if (!args || !args.LIGHT) {
                this._debugLog("setLightState: missing LIGHT argument", 'warn');
                return;
            }

            const lightId = this._normalizeObjectId(args.LIGHT);
            
            // La valeur est maintenant directement un boolean
            const isOn = Boolean(args.STATE);
            const colorValue = isOn ? "0xFFFF00" : "null";
            this._send("define_property", {
                object: lightId,
                property: "color",
                value: colorValue
            });
        } catch (error) {
            console.error(this._prefix + "error in setLightState: " + error);
        }
    }

    isLightOn() {
        // Bloc boolean qui retourne true (allumé)
        return true;
    }

    isLightOff() {
        // Bloc boolean qui retourne false (éteint)
        return false;
    }

    isSwitchClicked(args) {
        // BI-STABLE: retourner l'état courant du switch (reste vrai/faux jusqu'au prochain clic)
        const objectId = this._normalizeObjectId(args.SWITCH);
        return this._switchStates[objectId] === true;
    }
    

    defineProperty(args) {
        try {
            // Valider les arguments
            if (!args) {
                this._debugLog("defineProperty: missing arguments", 'warn');
                return;
            }
            if (!args.OBJECT || !args.PROPERTY || args.VALUE === undefined) {
                this._debugLog("defineProperty: missing required arguments (OBJECT, PROPERTY, or VALUE)", 'warn');
                return;
            }

            const objectId = this._normalizeObjectId(args.OBJECT);
            
            this._send("define_property", {
                object: objectId,
                property: args.PROPERTY,
                value: args.VALUE
            });
        } catch (error) {
            console.error(this._prefix + "error in defineProperty: " + error);
        }
    }


    getObjects() {
        this._debugLog("getObjects() called, objects count: " + Object.keys(this._objects).length);
        if (Object.keys(this._objects).length == 0) {
            return this._getEmptyListMessage("objects");
        }

        let objects = [];

        let ids = Object.keys(this._objects);
        for (let i = 0; i < ids.length; i++) {
            if (this._objects[ids[i]] && this._objects[ids[i]].name) {
                objects.push({
                    text: this._objects[ids[i]].name,
                    value: ids[i]
                });
            }
        }

        if (objects.length == 0) {
            this._debugLog("looks like some objects are stored but their names can't be retrieved", 'warn');
            return this._getEmptyListMessage("objects");
        }

        this._debugLog("getObjects() returning " + objects.length + " objects");
        return objects;
    }

    getObjectsPowerableLights() {
        let lights = this._sortObjects("com.eteks.sweethome3d.model.HomeLight");
        if (lights.length == 0) {
            return this._getEmptyListMessage("lights");
        }
        return lights;
    }

    getObjectsSwitches() {
        let switches = [];
        
        let ids = Object.keys(this._objects);
        for (let i = 0; i < ids.length; i++) {
            if (this._objects[ids[i]] && this._objects[ids[i]].name) {
                const objName = this._objects[ids[i]].name.toLowerCase();
                // Filtrer les objets dont le nom contient "switch" ou "interrupteur"
                if (objName.includes("switch") || objName.includes("interrupteur")) {
                    switches.push({
                        text: this._objects[ids[i]].name,
                        value: ids[i]
                    });
                }
            }
        }
        
        if (switches.length == 0) {
            return this._getEmptyListMessage("switches");
        }
        return switches;
    }

    getProperties() {
        this._debugLog("getProperties() called");
        
        // Liste statique des propriétés essentielles qui doivent toujours apparaître
        const essentialProperties = [
            "color", "shininess", "power", "lightColor",
            "x", "y", "z", "angle", "width", "depth", "height",
            "visible", "locked", "name", "id", "model", "texture"
        ];
        
        let properties = [...essentialProperties]; // Commencer avec les propriétés essentielles

        if (Object.keys(this._objects).length == 0) {
            // Même sans objets, retourner les propriétés essentielles
            return properties;
        }

        // Ajouter toutes les propriétés trouvées dans les objets
        let ids = Object.keys(this._objects);
        for (let i = 0; i < ids.length; i++) {
            if (this._objects[ids[i]]) {
                let current_properties = Object.keys(this._objects[ids[i]]);
                for (let u = 0; u < current_properties.length; u++) {
                    // Ignorer les propriétés internes
                    if (current_properties[u] !== "__scratchomisedClasses" && 
                        !properties.includes(current_properties[u])) {
                        properties.push(current_properties[u]);
                    }
                }
            }
        }

        // Trier les propriétés pour un affichage cohérent
        properties.sort();

        this._debugLog("getProperties() returning " + properties.length + " properties: " + properties.join(", "));
        return properties;
    }

    objectsLightsTurnOn(args) {
        // Allumer: mettre la couleur en jaune (0xFFFF00)
        this.defineProperty({
            OBJECT: this._normalizeObjectId(args.POWERABLE_LIGHT),
            PROPERTY: "color",
            VALUE: "0xFFFF00"
        })
    }

    objectsLightsTurnOff(args) {
        // Éteindre: réinitialiser la couleur (null pour revenir à la texture d'origine)
        this.defineProperty({
            OBJECT: this._normalizeObjectId(args.POWERABLE_LIGHT),
            PROPERTY: "color",
            VALUE: "null"
        })
    }

    isConnectedToServer(args) {
        // "Connecté" = socket OPEN + handshake OK (on a déjà reçu update_objects).
        // Sinon on a trop de faux positifs (socket ouverte sur un mauvais service / mauvais port).
        return Boolean(this.socket &&
            this.socket.readyState === WebSocket.OPEN &&
            this._receivedObjectsOnce === true);
    }

    getServerAddress(args) {
        const cfg = this._getServerConfigFromVariables();
        return cfg.server || this.server || "127.0.0.1";
    }

    getServerPort(args) {
        const cfg = this._getServerConfigFromVariables();
        return cfg.port || this.port || 80;
    }

    getObjectsCount(args) {
        return Object.keys(this._objects).length;
    }

    getObserverX(args) {
        // Retourner la position X de l'Observer dans la vue 2D de SweetHome3D (coordonnées Scratch)
        // Arrondir à 2 chiffres après la virgule
        return Math.round(this._observerX * 100) / 100;
    }

    getObserverY(args) {
        // Retourner la position Y de l'Observer dans la vue 2D de SweetHome3D (coordonnées Scratch)
        // Arrondir à 2 chiffres après la virgule
        return Math.round(this._observerY * 100) / 100;
    }

    getObserverDirection(args) {
        // Retourner la direction de l'Observer (en degrés Scratch, 90 = vers le haut)
        // La direction a déjà été inversée dans _updateObserverCoordinates
        // S'assurer que la direction est dans la plage 0-360
        let direction = this._observerDirection;
        if (direction < 0) {
            direction = ((direction % 360) + 360) % 360;
        } else if (direction >= 360) {
            direction = direction % 360;
        }
        return direction;
    }

    reconnectToServer(args) {
        // Permettre la reconnexion même après un reset
        this._shouldReconnect = true;
        this._reconnectAttempts = 0;
        this._reconnectDelay = 1000;
        // Forcer la recherche du sprite Observer au cas où il serait ajouté après le chargement
        this._getObserverSprite(true);
        this._reconnectSocket();
    }

    resetExtension(args) {
        // Fermer la connexion WebSocket
        if (this.socket) {
            try {
                // Empêcher la reconnexion automatique
                this._shouldReconnect = false;
                
                // Retirer les event listeners
                if (this._onCloseHandler) {
                    this.socket.removeEventListener("close", this._onCloseHandler);
                }
                if (this._onErrorHandler) {
                    this.socket.removeEventListener("error", this._onErrorHandler);
                }
                
                // Fermer la connexion proprement
                if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
                    this.socket.close(1000, "Reset requested");
                }
            } catch (error) {
                console.error(this._prefix + "error closing socket during reset: " + error);
            }
            this.socket = null;
        }
        
        // Vider la liste des objets
        this._objects = {};
        this._clickedSwitches = {}; // Réinitialiser aussi les clics
        this._switchStates = {}; // Réinitialiser les états bi-stables
        
        // Réinitialiser les variables
        this._menuVersion = 0;
        this._reconnectAttempts = 0;
        this._reconnectDelay = 1000;
        this._shouldReconnect = false; // Empêcher la reconnexion automatique, mais reconnectToServer/connectToServer peuvent la réactiver
        
        // Incrémenter menuVersion pour forcer la mise à jour des menus
        this._menuVersion++;
        
        this._debugLog("extension reset: connection closed and objects cleared (menu version: " + this._menuVersion + ")");
    }

    connectToServer(args) {
        // Valider les arguments
        if (!args || !args.SERVER || args.PORT === undefined) {
            this._debugLog("connectToServer: missing required arguments (SERVER or PORT)", 'warn');
            return;
        }
        
        // Mettre à jour les variables Scratch standard si elles existent (Stage de préférence)
        try {
            const varAddress = this._getScratchVarById("ScratchomisedServerAddressVar");
            if (varAddress) varAddress.value = args.SERVER || "127.0.0.1";
            const varPort = this._getScratchVarById("ScratchomisedServerPortVar");
            if (varPort) varPort.value = args.PORT || 80;
        } catch (error) {
            this._debugLog("Error updating server variables: " + error, 'warn');
        }
        
        // Permettre la reconnexion même après un reset
        this._shouldReconnect = true;
        // Utiliser les valeurs fournies ou les valeurs par défaut
        this.server = args.SERVER || "127.0.0.1";
        this.port = args.PORT || 80;
        // Le protocole est toujours "ws" pour WebSocket
        this.protocol = "ws";
        // Forcer la recherche du sprite Observer au cas où il serait ajouté après le chargement
        this._getObserverSprite(true);
        this._reconnectSocket();
    }

    _sortObjects(className) {
        let objects = [];
        
        let ids = Object.keys(this._objects);
        for (let i = 0; i < ids.length; i++) {
            if (this._objects[ids[i]] && 
                this._objects[ids[i]]["__scratchomisedClasses"] && 
                this._objects[ids[i]]["__scratchomisedClasses"].includes(className)) {
                objects.push({
                    text: this._objects[ids[i]].name,
                    value: ids[i]
                });
            }
        }

        if (objects.length == 0) {
            this._debugLog("looks like some objects are stored but their names can't be retrieved", 'warn');
            return this._getEmptyListMessage("objects");
        }

        return objects;
    }

    // Function to send data to the server
    _send(action, args = {}) {
        try {
            if (!this.socket) {
                console.warn(this._prefix + "cannot send data: socket is null");
                return;
            }
            if (this.socket.readyState !== WebSocket.OPEN) {
                console.warn(this._prefix + "cannot send data: socket state is " + this.socket.readyState + " (expected " + WebSocket.OPEN + ")");
                return;
            }
            const message = JSON.stringify({
                action: action,
                args: args
            });
            this._debugLog("sending message: " + action + " (size: " + message.length + " chars)");
            this.socket.send(message);
            this._debugLog("message sent successfully: " + action);
        } catch (error) {
            console.error(this._prefix + "error while sending data : \n" + error);
            console.error(this._prefix + "error stack: " + (error.stack || "no stack trace"));
        }
    }

    // Reconnect the socket (in case it failed to connect, or the server disconnected)
    _reconnectSocket() {
        // Close existing socket if any
        if (this.socket) {
            try {
                if (this._onCloseHandler) {
                    this.socket.removeEventListener("close", this._onCloseHandler);
                }
                if (this._onErrorHandler) {
                    this.socket.removeEventListener("error", this._onErrorHandler);
                }
                this.socket.close();
            } catch (error) {
                // Ignore errors when closing
            }
        }
        
        if (!this._shouldReconnect) {
            return;
        }
        
        try {
            const wsUrl = this.protocol + "://" + this.server + ":" + this.port;
            this._debugLog("attempting to connect to: " + wsUrl + " with protocol 'scratchomised'");
            this.socket = new WebSocket(wsUrl, "scratchomised");
            this._debugLog("WebSocket created, initial readyState: " + this.socket.readyState);
            this.socket.addEventListener("message", this._handleIncomingData.bind(this));
            // Reset handshake state for this connection attempt
            this._receivedObjectsOnce = false;
            if (this._clientReadyRetryTimer) {
                clearInterval(this._clientReadyRetryTimer);
                this._clientReadyRetryTimer = null;
            }
            
            this.socket.addEventListener("open", () => {
                this._debugLog("connected to server, readyState: " + this.socket.readyState);
                this._reconnectAttempts = 0; // Réinitialiser le compteur en cas de succès
                this._reconnectDelay = 1000; // Réinitialiser le délai
                
                // IMPORTANT: le serveur SweetHome3D n'envoie rien tant qu'il n'a pas reçu client_ready.
                // Envoyer immédiatement, puis retry tant qu'on n'a pas reçu update_objects.
                try {
                    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                        this._send("client_ready", {});
                    }
                } catch (error) {
                    console.error(this._prefix + "error sending client_ready: " + error);
                }

                // Retry toutes les 500ms jusqu'à réception de update_objects (max ~10s)
                let attempts = 0;
                this._clientReadyRetryTimer = setInterval(() => {
                    attempts++;
                    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
                    if (this._receivedObjectsOnce) {
                        clearInterval(this._clientReadyRetryTimer);
                        this._clientReadyRetryTimer = null;
                        return;
                    }
                    if (attempts > 20) { // 20 * 500ms = 10s
                        clearInterval(this._clientReadyRetryTimer);
                        this._clientReadyRetryTimer = null;
                        return;
                    }
                    this._send("client_ready", {});
                }, 500);
            });
            
            // Gérer les erreurs
            this._onErrorHandler = (error) => {
                console.error(this._prefix + "WebSocket error: " + error);
                if (error && error.message) {
                    console.error(this._prefix + "WebSocket error message: " + error.message);
                }
                if (error && error.type) {
                    console.error(this._prefix + "WebSocket error type: " + error.type);
                }
                if (error && error.target) {
                    console.error(this._prefix + "WebSocket error target readyState: " + error.target.readyState);
                }
                // Ne pas fermer la connexion en cas d'erreur, laisser la reconnexion automatique gérer
            };
            this.socket.addEventListener("error", this._onErrorHandler);
            
            // Gérer la fermeture avec reconnexion automatique
            // Stratégie de reconnexion : délai exponentiel avec limite maximale
            // - Délai initial : 1 seconde
            // - Multiplicateur : 2^n (n = numéro de tentative)
            // - Délai maximum : 30 secondes
            // - Fermeture propre (code 1000) : pas de reconnexion automatique
            this._onCloseHandler = (event) => {
                this._debugLog("disconnected from server (code: " + event.code + ", reason: " + event.reason + ", wasClean: " + event.wasClean + ")");
                
                // Ne pas reconnecter si c'est une fermeture intentionnelle (code 1000)
                if (event.code === 1000 && event.wasClean) {
                    this._debugLog("clean close, not reconnecting");
                    this._shouldReconnect = false;
                    return;
                }
                
                // Si la fermeture est trop rapide (< 1 seconde), attendre un peu plus avant de reconnecter
                const wasQuickClose = event.code !== 1000;
                
                // Reconnexion automatique avec délai exponentiel
                if (this._shouldReconnect && this._reconnectAttempts < this._maxReconnectAttempts) {
                    this._reconnectAttempts++;
                    let delay = Math.min(this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1), Scratchomised.MAX_RECONNECT_DELAY);
                    
                    // Si la fermeture était rapide, attendre un peu plus
                    if (wasQuickClose && this._reconnectAttempts === 1) {
                        delay = 2000; // Attendre 2 secondes pour la première reconnexion après une fermeture rapide
                    }
                    
                    this._debugLog("reconnecting in " + delay + "ms (attempt " + this._reconnectAttempts + "/" + this._maxReconnectAttempts + ")");
                    
                    setTimeout(() => {
                        if (this._shouldReconnect) {
                            this._reconnectSocket();
                        }
                    }, delay);
                } else if (this._reconnectAttempts >= this._maxReconnectAttempts) {
                    console.error(this._prefix + "max reconnection attempts reached, stopping reconnection");
                }
            };
            this.socket.addEventListener("close", this._onCloseHandler);
            
        } catch (error) {
            console.error(this._prefix + "error creating WebSocket: " + error);
            // Essayer de reconnecter après un délai
            if (this._shouldReconnect && this._reconnectAttempts < this._maxReconnectAttempts) {
                this._reconnectAttempts++;
                setTimeout(() => {
                    if (this._shouldReconnect) {
                        this._reconnectSocket();
                    }
                }, this._reconnectDelay);
            }
        }
    }

    // Handle data sent by the server
    _handleIncomingData(event) {
        // Wrapper global pour éviter que les erreurs ne ferment la connexion
        try {
            // Vérifier si les données sont valides
            if (!event || !event.data) {
                console.error(this._prefix + "received invalid event data");
                return;
            }
            
            let dataLength = event.data.length;
            this._debugLog("received message, size: " + dataLength + " chars");
            
            let message;
            try {
                message = JSON.parse(event.data);
                this._debugLog("message parsed successfully, action: " + (message ? message.action : "null"));
            } catch (error) {
                console.error(this._prefix + "unable to parse message : \n" + (event.data ? event.data.substring(0, 200) + "..." : "null") + "\n" + this._prefix + " got error : " + error);
                // Ne pas fermer la connexion en cas d'erreur de parsing
                return;
            }

            if (!message || !message.action) {
                console.warn(this._prefix + "message received but no action field");
                return;
            }

            // Traiter le message de manière asynchrone pour éviter de bloquer
            setTimeout(() => {
                try {
                    this._processMessage(message);
                } catch (error) {
                    console.error(this._prefix + "error in async message processing: " + error);
                    console.error(this._prefix + "error stack: " + (error.stack || "no stack trace"));
                }
            }, 0);
        } catch (error) {
            console.error(this._prefix + "critical error in _handleIncomingData: " + error);
            console.error(this._prefix + "error stack: " + (error.stack || "no stack trace"));
            // Ne pas fermer la connexion même en cas d'erreur critique
        }
    }

    // Traiter le message de manière séparée
    _processMessage(message) {
        switch (message.action) {
            case "test": {
                this._debugLog("received test message from server: " + (message.args ? message.args.message : "no message"));
                // Répondre au serveur pour confirmer la connexion
                this._send("test_ack", {});
                break;
            }
            case "welcome": {
                this._debugLog("received welcome message from server");
                // Répondre au serveur pour confirmer la connexion
                this._send("welcome_ack", {});
                break;
            }
            case "update_observer_position": {
                // Mise à jour uniquement de la position de l'Observer (plus efficace)
                if (!message.args) {
                    console.error(this._prefix + "missing argument for action update_observer_position");
                    return;
                }
                try {
                    this._updateObserverCoordinates(message.args);
                } catch (error) {
                    console.error(this._prefix + "error processing update_observer_position: " + error);
                    console.error(this._prefix + "error stack: " + (error.stack || "no stack trace"));
                }
                break;
            }
            case "update_objects": {
                if (!message.args || !message.args.objects) {
                    console.error(this._prefix + "missing argument for action update_objects : objects");
                    return;
                }
                try {
                    this._debugLog("processing update_objects with " + message.args.objects.length + " objects");
                    this._receivedObjectsOnce = true;
                    
                    // Mettre à jour les coordonnées de l'Observer si elles sont fournies
                    this._updateObserverCoordinates(message.args);
                    
                    // Créer une copie profonde des objets pour éviter les références circulaires
                    // Utiliser JSON.parse/stringify (acceptable pour la taille typique des objets)
                    const objectsStr = JSON.stringify(message.args.objects);
                    const objectsCopy = JSON.parse(objectsStr);
                    
                    const newObjects = {};
                    let processedCount = 0;
                    
                    // Traiter les objets de manière simple
                    for (let i = 0; i < objectsCopy.length; i++) {
                        try {
                            const obj = objectsCopy[i];
                            if (obj && obj["id"]) {
                                // Stocker l'objet tel quel (déjà nettoyé par JSON.parse/stringify)
                                newObjects[obj.id] = obj;
                                processedCount++;
                            }
                        } catch (objError) {
                            console.error(this._prefix + "error processing object " + i + ": " + objError);
                        }
                    }
                    
                    // Remplacer les objets seulement si le traitement a réussi
                    this._objects = newObjects;

                    // Synchroniser l'état bi-stable des interrupteurs à partir de la propriété "power" quand elle existe.
                    // Cela permet de conserver l'état même après une reconnexion, et de refléter l'état réel SH3D.
                    for (const id of Object.keys(newObjects)) {
                        const obj = newObjects[id];
                        if (!obj) continue;
                        const name = (obj.name || "").toString().toLowerCase();
                        const isSwitch = name.includes("switch") || name.includes("interrupteur");
                        if (!isSwitch) continue;
                        if (obj.power !== undefined && obj.power !== null && obj.power !== "") {
                            const p = parseFloat(obj.power);
                            if (!Number.isNaN(p)) {
                                this._switchStates[id] = p > 0.0;
                            }
                        }
                    }
                    
                    // Incrémenter le compteur pour signaler que les menus doivent être réévalués
                    this._menuVersion++;
                    this._debugLog("updated " + processedCount + " objects (menu version: " + this._menuVersion + ")");
                } catch (error) {
                    console.error(this._prefix + "error processing update_objects: " + error);
                    console.error(this._prefix + "error stack: " + (error.stack || "no stack trace"));
                    // Ne pas fermer la connexion en cas d'erreur
                }
                break;
            }
            case "object_clicked": {
                // Message reçu quand un objet est cliqué dans SweetHome3D
                if (message.args && message.args.object_id) {
                    const objectId = this._normalizeObjectId(message.args.object_id);
                    this._debugLog("object clicked: " + objectId);
                    // Toggle bi-stable: inverser l'état
                    this._switchStates[objectId] = !(this._switchStates[objectId] === true);
                    // Garder aussi une trace "impulsion" si besoin
                    this._clickedSwitches[objectId] = true;
                }
                break;
            }
            default: {
                this._debugLog("unknown action : " + message.action, 'warn');
            }
        }
    }
}

(function() {
    var extensionClass = Scratchomised;
    if (typeof window === "undefined" || !window.vm) {
        Scratch.extensions.register(new extensionClass());
    } else {
        var extensionInstance = new extensionClass(window.vm.extensionManager.runtime);
        var serviceName = window.vm.extensionManager._registerInternalExtension(extensionInstance);
        window.vm.extensionManager._loadedExtensions.set(extensionInstance.getInfo().id, serviceName);
    }
})();