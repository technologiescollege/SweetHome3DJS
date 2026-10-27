/*
 * LocalFileHomeController.js
 *
 * Fork-only: local Open/Save (.sh3x) via File System Access / download.
 * Kept out of SweetHome3DJSApplication.js so upstream ports stay easier.
 */

import { HomeController } from './SweetHome3D';
import { JSDialog } from './toolkit';
import { ResourceAction } from './ResourceAction';
import { HomeURLContent, ZIPTools } from './URLContent';
import {
  ensureSh3xFileName,
  formatHomeOpenError,
  isValidSaveAsFileName,
} from './LocalFileHelpers';
import {
  supportsFileSystemAccess,
  pickHomeFileToOpen,
  pickHomeFileToSave,
  writeBlobToFileHandle,
  downloadBlob,
} from './LocalFileAccess';

/**
 * Creates a home controller handling savings for local files.
 * @param {Home} [home] the home controlled by this controller
 * @param {HomeApplication} [application] 
 * @param {ViewFactory} [viewFactory]
 * @constructor
 * @author Emmanuel Puybaret
 * @ignore
 */
export class LocalFileHomeController extends HomeController {
  constructor(home, application, viewFactory) {
    super(home, application, viewFactory);
  }

  /**
   * Creates a new home after closing the current home.
   */
  newHome() {
    const controller = this;
    const newHomeTask = () => {
      controller.close();
      controller.application.addHome(controller.application.createHome());
    };

    if (this.home.isModified() || this.home.isRecovered()) {
      this.getView().confirmSave(this.application.configuration === undefined || this.home.getName() !== this.application.configuration.defaultHomeName ? this.home.getName() : null,
        (save) => {
          if (save) {
            controller.save(newHomeTask);
          } else {
            newHomeTask();
          }
        });
    } else {
      newHomeTask();
    }
  }

  /**
   * Opens a home from a local File (.sh3d / .sh3x). Used by the file picker and drag-and-drop.
   * @param {File} file
   * @param {FileSystemFileHandle} [fileHandle] handle FSA pour réécrire le même fichier au Save
   */
  openFromFile(file, fileHandle) {
    if (file == null) {
      return;
    }
    const controller = this;
    const preferences = controller.application.getUserPreferences();
    let cancelled = false;
    let finished = false;
    const openingTaskDialog = new JSDialog(preferences,
      preferences.getLocalizedString("ThreadedTaskPanel", "threadedTask.title"),
      preferences.getLocalizedString("HomeController", "openMessage"),
      {
        size: "small",
        disposer: function () {
          if (!finished) {
            cancelled = true;
          }
        }
      });
    const cancelBtn = openingTaskDialog.findElement(".dialog-cancel-button");
    if (cancelBtn) {
      cancelBtn.innerHTML =
        ResourceAction.getLocalizedLabelText(preferences, "ThreadedTaskPanel", "cancelButton.text");
    }
    openingTaskDialog.displayView();

    const homeName = file.name.indexOf("/") >= 0
      ? file.name.substring(file.name.lastIndexOf("/") + 1)
      : file.name;
    setTimeout(() => {
      if (cancelled) {
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      controller.application.getHomeRecorder().readHome(objectUrl, {
        homeLoaded: function (home) {
          if (cancelled) {
            ZIPTools.disposeZIP(objectUrl);
            URL.revokeObjectURL(objectUrl);
            return;
          }
          finished = true;
          home.setName(homeName);
          if (fileHandle != null) {
            home.localFileHandle = fileHandle;
          }
          controller.close();
          openingTaskDialog.close();
          // Révoquer le blob dès que plus aucun HomeURLContent ne le référence
          // (contenus déjà extraits vers IndexedDB) ; sinon le garder jusqu'à close().
          const stillLinked = [];
          controller.application.getHomeRecorder().searchContents(
            home, [], stillLinked,
            (content) => content instanceof HomeURLContent
              && content.getURL().indexOf(objectUrl) >= 0);
          if (stillLinked.length === 0) {
            ZIPTools.disposeZIP(objectUrl);
            URL.revokeObjectURL(objectUrl);
          } else {
            home.localFileObjectUrl = objectUrl;
          }
          controller.application.addHome(home);
        },
        homeError: function (error) {
          ZIPTools.disposeZIP(objectUrl);
          URL.revokeObjectURL(objectUrl);
          if (cancelled) {
            return;
          }
          finished = true;
          openingTaskDialog.close();
          const detail = formatHomeOpenError(error);
          console.error("Open home error:", error);
          const title = preferences.getLocalizedString("HomePane", "error.title");
          const body = preferences.getLocalizedString("HomeController", "openError", homeName)
            + "<br><pre style='white-space:pre-wrap;max-height:12em;overflow:auto;font-size:12px'>"
            + detail.replace(/</g, "&lt;")
            + "</pre>";
          new JSDialog(preferences, title, body, { size: "medium" }).displayView();
        }
      });
    }, 100);
  }

  /**
   * Opens a home chosen by the user from a local .sh3d / .sh3x file.
   */
  open() {
    const controller = this;
    const openWithInput = () => {
      const fileInput = document.createElement("input");
      fileInput.setAttribute("style", "display: none");
      fileInput.setAttribute("type", "file");
      fileInput.setAttribute("accept", ".sh3d,.sh3x,application/zip");
      document.body.appendChild(fileInput);
      fileInput.addEventListener("change", function () {
        document.body.removeChild(fileInput);
        if (this.files[0]) {
          controller.openFromFile(this.files[0]);
        }
      });
      fileInput.click();
    };
    const openHome = () => {
      if (supportsFileSystemAccess()) {
        pickHomeFileToOpen().then((picked) => {
          if (picked != null) {
            controller.openFromFile(picked.file, picked.handle);
          }
        }).catch(() => openWithInput());
      } else {
        openWithInput();
      }
    };

    if (this.home.isModified() || this.home.isRecovered()) {
      this.getView().confirmSave(this.application.configuration === undefined || this.home.getName() !== this.application.configuration.defaultHomeName ? this.home.getName() : null,
        (save) => {
          if (save) {
            controller.save(openHome);
          } else {
            openHome();
          }
        });
    } else {
      openHome();
    }
  }

  /**
   * Opens a dropped local file after optional save confirmation.
   * @param {File} file
   */
  openDroppedFile(file) {
    if (file == null) {
      return;
    }
    const controller = this;
    const proceed = () => controller.openFromFile(file);
    if (this.home.isModified() || this.home.isRecovered()) {
      this.getView().confirmSave(
        this.application.configuration === undefined
          || this.home.getName() !== this.application.configuration.defaultHomeName
          ? this.home.getName()
          : null,
        (save) => {
          if (save) {
            controller.save(proceed);
          } else {
            proceed();
          }
        });
    } else {
      proceed();
    }
  }

  /**
   * Écrit le blob sur le disque (handle FSA si possible, sinon téléchargement).
   * @param {Home} home
   * @param {Blob} blob
   * @param {string} homeName
   * @param {function} [postSaveTask]
   * @param {JSDialog} [savingTaskDialog]
   * @private
   */
  #deliverSavedBlob(home, blob, homeName, postSaveTask, savingTaskDialog) {
    const preferences = this.application.getUserPreferences();
    const finishOk = () => {
      home.setModified(false);
      home.setRecovered(false);
      if (postSaveTask !== undefined) {
        postSaveTask();
      }
    };
    const fail = (error) => {
      console.error("Save deliver error:", error);
      new JSDialog(preferences,
        preferences.getLocalizedString("HomePane", "error.title"),
        preferences.getLocalizedString("HomeController", "saveError", homeName,
          formatHomeOpenError(error).replace(/</g, "&lt;")),
        { size: "small" }).displayView();
    };

    const handle = home.localFileHandle;
    if (handle != null) {
      writeBlobToFileHandle(handle, blob).then(() => {
        finishOk();
      }).catch((ex) => {
        // Permission perdue / handle invalide → téléchargement
        console.warn("FSA write failed, fallback download:", ex);
        home.localFileHandle = null;
        try {
          downloadBlob(blob, homeName);
          finishOk();
        } catch (ex2) {
          fail(ex2);
        }
      });
      return;
    }
    try {
      downloadBlob(blob, homeName);
      finishOk();
    } catch (ex) {
      fail(ex);
    }
  }

  /**
   * Saves the home managed by this controller. If home name doesn't exist,
   * this method will act as {@link #saveAs() saveAs} method.
   * @param {function} [postSaveTask]
   */
  save(postSaveTask) {
    if (this.home.getName() == null
      || (this.application.configuration !== undefined && this.home.getName() === this.application.configuration.defaultHomeName)) {
      this.saveAs(postSaveTask);
    } else if (this.home.localFileHandle == null && supportsFileSystemAccess()) {
      // Première sauvegarde sans handle : proposer un fichier cible (évite N téléchargements)
      this.saveAs(postSaveTask);
    } else {
      const preferences = this.application.getUserPreferences();
      const savingTaskDialog = new JSDialog(preferences,
        preferences.getLocalizedString("ThreadedTaskPanel", "threadedTask.title"),
        preferences.getLocalizedString("HomeController", "saveMessage"),
        {
          size: "small",
          disposer: function (dialog) {
            if (dialog.writingOperation !== undefined) {
              dialog.writingOperation.abort();
            }
          }
        });
      if (this.application.getHomeRecorder().configuration && this.application.getHomeRecorder().configuration.writeHomeWithWorker) {
        savingTaskDialog.findElement(".dialog-cancel-button").innerHTML =
          ResourceAction.getLocalizedLabelText(preferences, "ThreadedTaskPanel", "cancelButton.text");
      } else {
        savingTaskDialog.findElement(".dialog-cancel-button").style = "display: none";
      }
      savingTaskDialog.displayView();

      const controller = this;
      const homeExtension = this.application.getUserPreferences().getLocalizedString("FileContentManager", "homeExtension");   // .sh3d
      const homeExtension2 = this.application.getUserPreferences().getLocalizedString("FileContentManager", "homeExtension2"); // .sh3x
      const homeName = ensureSh3xFileName(controller.home.getName(), homeExtension, homeExtension2);
      if (homeName !== controller.home.getName()) {
        controller.home.setName(homeName);
      }
      setTimeout(() => {
        savingTaskDialog.writingOperation = controller.application.getHomeRecorder().writeHome(controller.home, homeName, {
          homeSaved: function (home, blob) {
            delete savingTaskDialog.writingOperation;
            savingTaskDialog.close();
            controller.#deliverSavedBlob(home, blob, homeName, postSaveTask, savingTaskDialog);
          },
          homeError: function (status, error) {
            savingTaskDialog.close();
            console.error(status, error);
            new JSDialog(preferences,
              preferences.getLocalizedString("HomePane", "error.title"),
              preferences.getLocalizedString("HomeController", "saveError", homeName, status + "<br>" + error),
              { size: "small" }).displayView();
          }
        });
      }, 200); // Add a little delay to ensure savingTaskDialog is displayed immediately and when no worker started
    }
  }

  /**
   * Saves the home managed by this controller with a different name.
   * @param {function} [postSaveTask]
   */
  saveAs(postSaveTask) {
    const preferences = this.application.getUserPreferences();
    const controller = this;
    const homeExtension = preferences.getLocalizedString("FileContentManager", "homeExtension");   // .sh3d
    const homeExtension2 = preferences.getLocalizedString("FileContentManager", "homeExtension2"); // .sh3x
    const defaultBase = (this.application.configuration && this.application.configuration.defaultHomeName)
      || "Home";
    const suggested = (this.home.getName()
      && this.application.configuration
      && this.home.getName() !== this.application.configuration.defaultHomeName)
      ? ensureSh3xFileName(this.home.getName(), homeExtension, homeExtension2)
      : ensureSh3xFileName(defaultBase, homeExtension, homeExtension2);

    const startWrite = (homeName, fileHandle) => {
      controller.home.setName(homeName);
      if (fileHandle != null) {
        controller.home.localFileHandle = fileHandle;
      }
      // Évite la boucle save → saveAs quand le handle vient d'être choisi
      const preferencesInner = controller.application.getUserPreferences();
      const savingTaskDialog = new JSDialog(preferencesInner,
        preferencesInner.getLocalizedString("ThreadedTaskPanel", "threadedTask.title"),
        preferencesInner.getLocalizedString("HomeController", "saveMessage"),
        {
          size: "small",
          disposer: function (dialog) {
            if (dialog.writingOperation !== undefined) {
              dialog.writingOperation.abort();
            }
          }
        });
      if (controller.application.getHomeRecorder().configuration
        && controller.application.getHomeRecorder().configuration.writeHomeWithWorker) {
        savingTaskDialog.findElement(".dialog-cancel-button").innerHTML =
          ResourceAction.getLocalizedLabelText(preferencesInner, "ThreadedTaskPanel", "cancelButton.text");
      } else {
        savingTaskDialog.findElement(".dialog-cancel-button").style = "display: none";
      }
      savingTaskDialog.displayView();
      setTimeout(() => {
        savingTaskDialog.writingOperation = controller.application.getHomeRecorder().writeHome(controller.home, homeName, {
          homeSaved: function (home, blob) {
            delete savingTaskDialog.writingOperation;
            savingTaskDialog.close();
            controller.#deliverSavedBlob(home, blob, homeName, postSaveTask, savingTaskDialog);
          },
          homeError: function (status, error) {
            savingTaskDialog.close();
            console.error(status, error);
            new JSDialog(preferencesInner,
              preferencesInner.getLocalizedString("HomePane", "error.title"),
              preferencesInner.getLocalizedString("HomeController", "saveError", homeName, status + "<br>" + error),
              { size: "small" }).displayView();
          }
        });
      }, 200);
    };

    if (supportsFileSystemAccess()) {
      pickHomeFileToSave(suggested).then((handle) => {
        if (handle == null) {
          return;
        }
        const name = ensureSh3xFileName(handle.name || suggested, homeExtension, homeExtension2);
        startWrite(name, handle);
      });
      return;
    }

    const html =
      '<div class="column1">' +
      '  <label for="local-save-as-name">@{AppletContentManager.showSaveDialog.message}</label>' +
      '  <input id="local-save-as-name" type="text" class="local-save-as-name" style="width:100%;box-sizing:border-box;margin-top:0.5em" />' +
      '  <div class="local-save-as-hint" style="margin-top:0.4em;font-size:12px;opacity:0.75"></div>' +
      '</div>';
    const saveAsDialog = new JSDialog(preferences,
      preferences.getLocalizedString("FileContentManager", "saveDialog.title"),
      html,
      {
        size: "small",
        applier: function () {
          const input = saveAsDialog.findElement(".local-save-as-name");
          let homeName = input != null ? input.value.trim() : "";
          if (!isValidSaveAsFileName(homeName)) {
            return;
          }
          homeName = ensureSh3xFileName(homeName, homeExtension, homeExtension2);
          startWrite(homeName, null);
        }
      });
    const nameInput = saveAsDialog.findElement(".local-save-as-name");
    const okButton = saveAsDialog.findElement(".dialog-ok-button");
    const hint = saveAsDialog.findElement(".local-save-as-hint");
    const syncOk = () => {
      const valid = isValidSaveAsFileName(nameInput ? nameInput.value : "");
      if (okButton) {
        okButton.disabled = !valid;
      }
      if (hint) {
        hint.textContent = valid ? "" : "Nom de fichier requis (sans chemin)";
      }
    };
    if (nameInput != null) {
      nameInput.value = suggested;
      nameInput.addEventListener("input", syncOk);
      nameInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (isValidSaveAsFileName(nameInput.value)) {
            saveAsDialog.validate();
          }
        }
      });
    }
    saveAsDialog.displayView();
    syncOk();
    if (nameInput != null) {
      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 50);
    }
  }

  /**
   * Removes home from application homes list.
   */
  close() {
    if (this.home.localFileObjectUrl) {
      ZIPTools.disposeZIP(this.home.localFileObjectUrl);
      URL.revokeObjectURL(this.home.localFileObjectUrl);
      this.home.localFileObjectUrl = null;
    }
    this.home.setRecovered(false);
    this.application.deleteHome(this.home);
    this.getView().dispose();
  }
}
