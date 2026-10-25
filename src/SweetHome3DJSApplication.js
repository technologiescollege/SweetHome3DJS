/*
 * SweetHome3DJSApplication.js
 *
 * Sweet Home 3D, Copyright (c) 2024 Space Mushrooms <info@sweethome3d.com>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

import {
  CollectionEvent,
  HomeApplication,
  HomeController,
} from './SweetHome3D';

import { DirectHomeRecorder } from './DirectHomeRecorder';
import { JSViewFactory } from './JSViewFactory';
import { HomeRecorder } from './HomeRecorder';
import { IncrementalHomeRecorder } from './IncrementalHomeRecorder';
import { RecordedUserPreferences, DefaultUserPreferences } from './UserPreferences';
import { JSDialog, } from './toolkit';
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

/**
 * Creates a home controller handling savings from user interface.
 * @param {Home} [home] the home controlled by this controller
 * @param {HomeApplication} [application] 
 * @param {ViewFactory} [viewFactory]
 * @constructor
 * @author Emmanuel Puybaret
 * @ignore
 */
export class DirectRecordingHomeController extends HomeController {
  constructor(home, application, viewFactory) {
    super(home, application, viewFactory);
  }

  /**
   * Creates a new home after saving and closing the current home.
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
   * Opens a home after saving and deleting the current home.
   */
  open() {
    const controller = this;
    const preferences = controller.application.getUserPreferences();
    const readTask = homeName => {
      if (homeName != null && homeName.length > 0) {
        controller.application.getHomeRecorder().readHome(homeName,
          {
            homeLoaded: function (home) {
              home.setName(homeName);
              controller.close();
              controller.application.addHome(home);
            },
            homeError: function (error) {
              const detail = formatHomeOpenError(error);
              console.error("Open home error:", error);
              const title = preferences.getLocalizedString("HomePane", "error.title");
              const body = preferences.getLocalizedString("HomeController", "openError", homeName)
                + "<br><pre style='white-space:pre-wrap;max-height:12em;overflow:auto;font-size:12px'>"
                + detail.replace(/</g, "&lt;")
                + "</pre>";
              new JSDialog(preferences, title, body, { size: "medium" }).displayView();
            },
            progression: function (part, info, percentage) {
            }
          });
      }
    };
    const selectHome = () => {
      const request = controller.application.getHomeRecorder().getAvailableHomes({
        availableHomes: function (homes) {
          if (homes.length == 0) {
            const message = preferences.getLocalizedString("AppletContentManager", "showOpenDialog.noAvailableHomes");
            new JSDialog(preferences,
              preferences.getLocalizedString("HomePane", "error.title"),
              message, { size: "small" }).displayView();
          } else {
            const html =
              '  <div class="column1">' +
              '    <div>@{AppletContentManager.showOpenDialog.message}</div>' +
              '    <div class="home-list"></div>' +
              '  </div>';
            const fileDialog = new JSDialog(preferences, "@{FileContentManager.openDialog.title}", html,
              {
                size: "small",
                applier: function (dialog) {
                  const selectedItem = fileDialog.findElement(".selected");
                  if (selectedItem != null) {
                    readTask(selectedItem.innerText);
                  }
                },
              });
            fileDialog.getHTMLElement().classList.add("open-dialog");
            const okButton = fileDialog.findElement(".dialog-ok-button");
            okButton.innerHTML = preferences.getLocalizedString("AppletContentManager", "showOpenDialog.open");
            okButton.disabled = true;
            const cancelButton = fileDialog.findElement(".dialog-cancel-button");
            cancelButton.innerHTML = preferences.getLocalizedString("AppletContentManager", "showOpenDialog.cancel");
            const deleteButton = document.createElement("button");
            deleteButton.innerHTML = preferences.getLocalizedString("AppletContentManager", "showOpenDialog.delete");
            deleteButton.disabled = true;
            cancelButton.parentElement.insertBefore(deleteButton, cancelButton);
            const homeList = fileDialog.findElement(".home-list");

            for (let i = 0; i < homes.length; i++) {
              const item = document.createElement("div");
              item.classList.add("item");
              item.innerHTML = homes[i];
              homeList.appendChild(item);
            }

            const items = homeList.childNodes;
            fileDialog.registerEventListener(items, "click", (ev) => {
              for (let i = 0; i < items.length; i++) {
                if (ev.target == items[i]) {
                  items[i].classList.add("selected");
                  okButton.disabled = false;
                  deleteButton.disabled = ev.target.innerHTML == controller.home.getName();
                } else {
                  items[i].classList.remove("selected");
                }
              }
            });
            fileDialog.registerEventListener(items, "dblclick", () => {
              fileDialog.validate();
            });
            fileDialog.registerEventListener(deleteButton, "click", (ev) => {
              const item = fileDialog.findElement(".selected");
              controller.confirmDeleteHome(item.innerText, () => {
                controller.application.getHomeRecorder().deleteHome(item.innerText, {
                  homeDeleted: function () {
                    item.remove();
                    okButton.disabled = true;
                    deleteButton.disabled = true;
                  },
                  homeError: function (status, error) {
                    const message = preferences.getLocalizedString("AppletContentManager", "confirmDeleteHome.errorMessage", item.innerText);
                    console.error(message, error);
                    new JSDialog(preferences,
                      preferences.getLocalizedString("HomePane", "error.title"),
                      message, { size: "small" }).displayView();
                  }
                });
              });
            });
            fileDialog.displayView();
          }
        },
        homesError: function (status, error) {
          const message = preferences.getLocalizedString("AppletContentManager", "showOpenDialog.availableHomesError");
          console.error(message, error);
          new JSDialog(preferences,
            preferences.getLocalizedString("HomePane", "error.title"),
            message, { size: "small" }).displayView();
        }
      });

      if (request == null) {
        const message = preferences.getLocalizedString("AppletContentManager", "showOpenDialog.message");
        readTask(prompt(message));
      }
    };

    if (this.home.isModified() || this.home.isRecovered()) {
      this.getView().confirmSave(this.application.configuration === undefined || this.home.getName() !== this.application.configuration.defaultHomeName ? this.home.getName() : null,
        (save) => {
          if (save) {
            controller.save(selectHome);
          } else {
            selectHome();
          }
        });
    } else {
      selectHome();
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
      savingTaskDialog.findElement(".dialog-cancel-button").innerHTML =
        ResourceAction.getLocalizedLabelText(preferences, "ThreadedTaskPanel", "cancelButton.text");
      savingTaskDialog.displayView();

      const controller = this;
      savingTaskDialog.writingOperation = this.application.getHomeRecorder().writeHome(this.home, this.home.getName(), {
        homeSaved: function (home) {
          delete savingTaskDialog.writingOperation;
          savingTaskDialog.close();
          home.setModified(false);
          home.setRecovered(false);
          if (postSaveTask !== undefined) {
            postSaveTask();
          }
        },
        homeError: function (status, error) {
          savingTaskDialog.close();
          new JSDialog(preferences,
            preferences.getLocalizedString("HomePane", "error.title"),
            preferences.getLocalizedString("HomeController", "saveError", [controller.home.getName(), error]),
            { size: "small" }).displayView();
        }
      });
    }
  }

  /**
   * Saves the home managed by this controller with a different name.
   * @param {function} [postSaveTask]
   */
  saveAs(postSaveTask) {
    const preferences = this.application.getUserPreferences();
    const message = preferences.getLocalizedString("AppletContentManager", "showSaveDialog.message");
    const homeName = prompt(message, this.home.getName() != null
      && (this.application.configuration === undefined
        || this.home.getName() !== this.application.configuration.defaultHomeName)
      ? this.home.getName()
      : undefined);

    if (homeName != null && homeName.length > 0) {
      const controller = this;
      const request = controller.application.getHomeRecorder().getAvailableHomes({
        availableHomes: function (homeNames) {
          let homeExists = false;
          for (let i = 0; i < homeNames.length; i++) {
            if (homeName == homeNames[i]) {
              homeExists = true;
            }
          }
          if (!homeExists) {
            controller.home.setName(homeName);
            controller.save(postSaveTask);
          } else {
            const message = preferences.getLocalizedString("FileContentManager", "confirmOverwrite.message", homeName).replace(/\<br\>/g, " ");
            const confirmOverwriteDialog = new JSDialog(preferences,
              preferences.getLocalizedString("FileContentManager", "confirmOverwrite.title"),
              message + "</font>",
              {
                size: "small",
                applier: function () {
                  controller.home.setName(homeName);
                  controller.save(postSaveTask);
                }
              });
            confirmOverwriteDialog.findElement(".dialog-ok-button").innerHTML =
              preferences.getLocalizedString("FileContentManager", "confirmOverwrite.overwrite");
            const cancelButton = confirmOverwriteDialog.findElement(".dialog-cancel-button");
            cancelButton.innerHTML = preferences.getLocalizedString("FileContentManager", "confirmOverwrite.cancel");
            confirmOverwriteDialog.displayView();
          }
        },
        homesError: function (status, error) {
          const message = preferences.getLocalizedString("AppletContentManager", "showSaveDialog.checkHomeError");
          console.error(message, error);
          new JSDialog(preferences,
            preferences.getLocalizedString("HomePane", "error.title"),
            message, { size: "small" }).displayView();
        }
      });

      if (request == null) {
        this.home.setName(homeName);
        this.save(postSaveTask);
      };
    }
  }

  /**
   * Removes home from application homes list.
   */
  close() {
    this.home.setRecovered(false);
    this.application.deleteHome(this.home);
    this.getView().dispose();
  }

  /**
   * Displays a dialog that lets user choose whether he wants to delete
   * a home or not, then calls <code>confirm</code>.
   * @param {function} confirm 
   * @private
   */
  confirmDeleteHome(homeName, confirm) {
    const preferences = this.application.getUserPreferences();
    const message = preferences.getLocalizedString("AppletContentManager", "confirmDeleteHome.message", homeName).replace(/\<br\>/g, " ");
    const confirmDeletionDialog = new JSDialog(preferences,
      preferences.getLocalizedString("AppletContentManager", "confirmDeleteHome.title"),
      message + "</font>",
      {
        size: "small",
        applier: function () {
          confirm();
        }
      });
    confirmDeletionDialog.findElement(".dialog-ok-button").innerHTML =
      preferences.getLocalizedString("AppletContentManager", "confirmDeleteHome.delete");
    const cancelButton = confirmDeletionDialog.findElement(".dialog-cancel-button");
    cancelButton.innerHTML = preferences.getLocalizedString("AppletContentManager", "confirmDeleteHome.cancel");
    confirmDeletionDialog.displayView();
  }
}

/**
 * <code>HomeApplication</code> implementation for JavaScript.
 * @param {{furnitureCatalogURLs: string[],
 *          furnitureResourcesURLBase: string,
 *          texturesCatalogURLs: string[],
 *          texturesResourcesURLBase: string,
 *          readHomeURL: string,
 *          writeHomeEditsURL|writeHomeURL: string,
 *          closeHomeURL: string,
 *          writeResourceURL: string,
 *          readResourceURL: string,
 *          writePreferencesURL: string,
 *          readPreferencesURL: string,
 *          writePreferencesResourceURL: string,
 *          readPreferencesResourceURL: string,
 *          pingURL: string,
 *          autoWriteDelay: number,
 *          trackedHomeProperties: string[],
 *          autoWriteTrackedStateChange: boolean,
 *          defaultUserLanguage: string,
 *          writeCacheResourceURL: string,
 *          readCacheResourceURL: string,
 *          listCacheResourcesURL: string,
 *          listHomesURL: string,
 *          deleteHomeURL: string,
 *          autoRecovery: boolean,
 *          autoRecoveryDatabase: string,
 *          autoRecoveryObjectstore: string,
 *          silentAutoRecovery: boolean,
 *          compressionLevel: number,
 *          includeAllContent: boolean,
 *          writeDataType: string,
 *          writeHomeWithWorker: boolean, 
 *          defaultHomeName: string,
 *          writingObserver: {writeStarted: Function, 
 *                            writeSucceeded: Function, 
 *                            writeFailed: Function, 
 *                            connectionFound: Function, 
 *                            connectionLost: Function}}  [configuration] 
 *              the URLs of resources and services required on server
 *              (if undefined, will use local files for testing).
 *              If writePreferencesResourceURL / readPreferencesResourceURL is missing,
 *              writeResourceURL / readResourceURL will be used.
 *              If writeHomeEditsURL and readHomeURL are missing, application recorder will be 
 *              an instance of <code>HomeRecorder</code>.
 *              If writeHomeEditsURL is missing, application recorder will be 
 *              an instance of <code>DirectHomeRecorder</code>.
 *              Auto recovery not available for incremental recorder.
 * @constructor
 * @author Emmanuel Puybaret
 * @author Renaud Pawlak
 */
export class SweetHome3DJSApplication extends HomeApplication {
  constructor(configuration) {
    super();
    this.homeControllers = [];
    this.configuration = configuration;
    const application = this;
    this.addHomesListener((ev) => {
      if (ev.getType() == CollectionEvent.Type.ADD) {
        const homeController = application.createHomeController(ev.getItem());
        application.homeControllers.push(homeController);
        if (application.getHomeRecorder() instanceof IncrementalHomeRecorder) {
          application.getHomeRecorder().addHome(ev.getItem(), homeController);
        }
        homeController.getView();
      } else if (ev.getType() == CollectionEvent.Type.DELETE) {
        application.homeControllers.splice(ev.getIndex(), 1);
        if (application.getHomeRecorder() instanceof IncrementalHomeRecorder) {
          application.getHomeRecorder().removeHome(ev.getItem());
        }
      }
    });

    if (this.configuration !== undefined
      && this.configuration.autoRecovery
      && this.configuration.writeHomeEditsURL === undefined) {
      setTimeout(() => {
        // Launch auto recovery manager
        application.autoRecoveryManager = new AutoRecoveryManager(application);
      });
    }
  }

  getVersion() {
    return "7.5.2";
  }

  getHomeRecorder() {
    if (!this.homeRecorder) {
      this.homeRecorder = this.configuration === undefined || this.configuration.readHomeURL === undefined
        ? new HomeRecorder(this.configuration)
        : (this.configuration.writeHomeEditsURL !== undefined
          ? new IncrementalHomeRecorder(this, this.configuration)
          : new DirectHomeRecorder(this.configuration));
    }
    return this.homeRecorder;
  }

  getUserPreferences() {
    if (this.preferences == null) {
      if (this.configuration === undefined) {
        this.preferences = new DefaultUserPreferences();
      } else {
        this.preferences = new RecordedUserPreferences(this.configuration);
      }
    }
    return this.preferences;
  }

  createHome() {
    const home = HomeApplication.prototype.createHome.call(this);
    if (this.configuration !== undefined && this.configuration.defaultHomeName !== undefined) {
      home.setName(this.configuration.defaultHomeName);
    }
    return home;
  }

  /**
   * Returns the view factory which will create the views associated to their controllers. 
   * @return {Object}
   */
  getViewFactory() {
    if (this.viewFactory == null) {
      this.viewFactory = new JSViewFactory(this);
    }
    return this.viewFactory;
  }

  /**
   * Create the <code>HomeController</code> which controls the given <code>home</code>.
   * @param {Home} home
   */
  createHomeController(home) {
    return this.configuration === undefined || this.configuration.readHomeURL === undefined
      ? new LocalFileHomeController(home, this, this.getViewFactory())
      : (this.configuration.writeHomeEditsURL !== undefined
        ? new HomeController(home, this, this.getViewFactory())
        : new DirectRecordingHomeController(home, this, this.getViewFactory()));
  }

  /**
   * Returns the <code>HomeController</code> associated to the given <code>home</code>.
   * @return {HomeController}
   */
  getHomeController(home) {
    return this.homeControllers[this.getHomes().indexOf(home)];
  }
}


/**
 * Manager able to automatically save open homes in recovery database with a timer.
 * The delay between two automatic save operations is specified by 
 * {@link UserPreferences#getAutoSaveDelayForRecovery() auto save delay for recovery}
 * property.
 * @constructor
 * @param {SweetHome3DJSApplication} application
 * @ignore
 * @author Emmanuel Puybaret
 */
export class AutoRecoveryManager {
  constructor(application) {
    this.application = application;
    let autoRecoveryDatabase = "SweetHome3DJS";
    let autoRecoveryObjectstore = "Recovery";
    if (application.configuration.autoRecoveryDatabase !== undefined) {
      autoRecoveryDatabase = application.configuration.autoRecoveryDatabase;
    }
    if (application.configuration.autoRecoveryObjectstore !== undefined) {
      autoRecoveryObjectstore = application.configuration.autoRecoveryObjectstore;
    }

    const manager = this;
    this.autoRecoveryDatabaseUrlBase = "indexeddb://" + autoRecoveryDatabase + "/" + autoRecoveryObjectstore;

    // Auto recovery recorder stores data in autoRecoveryObjectstore object store of IndexedDB
    class AutoRecoveryRecorder extends DirectHomeRecorder {
      constructor() {
        super({
          readHomeURL: manager.autoRecoveryDatabaseUrlBase + "/content?name=%s.recovered",
          writeHomeURL: manager.autoRecoveryDatabaseUrlBase + "?keyPathField=name&contentField=content&dateField=date&name=%s.recovered",
          readResourceURL: manager.autoRecoveryDatabaseUrlBase + "/content?name=%s",
          writeResourceURL: manager.autoRecoveryDatabaseUrlBase + "?keyPathField=name&contentField=content&dateField=date&name=%s",
          listHomesURL: manager.autoRecoveryDatabaseUrlBase + "?name=(.*).recovered",
          deleteHomeURL: manager.autoRecoveryDatabaseUrlBase + "?name=%s.recovered",
          writeHomeWithWorker: true
        });
      }

      // Reuse XML handler of application recorder
      getHomeXMLHandler() {
        return application.getHomeRecorder().getHomeXMLHandler();
      }

      // Reuse XML exporter of application recorder
      getHomeXMLExporter() {
        return application.getHomeRecorder().getHomeXMLExporter();
      }
    }

    this.autoSaveRecorder = new AutoRecoveryRecorder();
    this.recoveredHomeNames = [];
    const homeExtension1 = application.getUserPreferences().getLocalizedString("FileContentManager", "homeExtension");
    const homeExtension2 = application.getUserPreferences().getLocalizedString("FileContentManager", "homeExtension2");
    const homeModificationListener = ev => {
      const home = ev.getSource();
      if (!home.isModified()) {
        home.removePropertyChangeListener("MODIFIED", homeModificationListener);
        // Delete auto saved in 1s in case user was traversing quickly the undo/redo pile
        setTimeout(() => {
          if (!home.isModified()) {
            manager.deleteRecoveredHome(home.getName());
          }
          home.addPropertyChangeListener("MODIFIED", homeModificationListener);
        }, 1000);
      }
    };
    const homeNameModificationListener = ev => {
      manager.recoveredHomeNames.splice(manager.recoveredHomeNames.indexOf(ev.getOldValue()), 1);
      if (!ev.getSource().isRecovered()) {
        manager.deleteRecoveredHome(ev.getOldValue());
      }
      manager.recoveredHomeNames.push(ev.getNewValue());
    };
    const homesListener = ev => {
      const home = ev.getItem();
      if (ev.getType() == CollectionEvent.Type.ADD) {
        manager.autoSaveRecorder.getAvailableHomes({
          availableHomes: function (homeNames) {
            if (home.getName() != null) {
              manager.recoveredHomeNames.push(home.getName());
            }
            let recoveredHome = false;
            for (let i = 0; i < homeNames.length; i++) {
              if (home.getName() != null
                && this.homeNamesEqual(home.getName(), homeNames[i])) {
                recoveredHome = true;
                const recoveredName = homeNames[i];
                const attachNormalListeners = () => {
                  home.addPropertyChangeListener("MODIFIED", homeModificationListener);
                  home.addPropertyChangeListener("NAME", homeNameModificationListener);
                  if (home.isModified()) {
                    manager.saveRecoveredHomes();
                    manager.restartTimer();
                  }
                };
                const declineRecover = () => {
                  manager.recoveredHomeNames.splice(manager.recoveredHomeNames.indexOf(home.getName()), 1);
                  manager.deleteRecoveredHome(recoveredName);
                  attachNormalListeners();
                };
                const proceedRecover = () => {
                  manager.autoSaveRecorder.readHome(recoveredName, {
                    homeLoaded: function (replacingHome) {
                      application.removeHomesListener(homesListener);
                      application.getHomeController(home).close();
                      const homeName = replacingHome.getName();
                      replacingHome.setRecovered(true);
                      replacingHome.addPropertyChangeListener("RECOVERED", (ev) => {
                        if (!replacingHome.isRecovered()) {
                          manager.recoveredHomeNames.splice(manager.recoveredHomeNames.indexOf(replacingHome.getName()), 1);
                          manager.deleteRecoveredHome(homeName);
                          replacingHome.addPropertyChangeListener("MODIFIED", homeModificationListener);
                        }
                      });
                      replacingHome.addPropertyChangeListener("NAME", homeNameModificationListener);
                      application.addHome(replacingHome);
                      application.addHomesListener(homesListener);
                    },
                    homeError: function (error) {
                      const preferences = application.getUserPreferences();
                      const detail = formatHomeOpenError(error);
                      console.error("Recover home error:", error);
                      const body = preferences.getLocalizedString("HomeController", "openError", home.getName())
                        + "<br><pre style='white-space:pre-wrap;max-height:12em;overflow:auto;font-size:12px'>"
                        + detail.replace(/</g, "&lt;")
                        + "</pre>";
                      new JSDialog(preferences,
                        preferences.getLocalizedString("HomePane", "error.title"),
                        body, { size: "medium" }).displayView();
                      attachNormalListeners();
                    },
                  });
                };
                if (application.configuration.silentAutoRecovery) {
                  proceedRecover();
                } else {
                  const preferences = application.getUserPreferences();
                  let accepted = false;
                  const confirmDialog = new JSDialog(preferences,
                    preferences.getLocalizedString("HomePane", "message.title"),
                    preferences.getLocalizedString("SweetHome3DJSApplication", "confirmRecoverHome"),
                    {
                      size: "small",
                      applier: function () {
                        accepted = true;
                        proceedRecover();
                      },
                      disposer: function () {
                        if (!accepted) {
                          declineRecover();
                        }
                      }
                    });
                  confirmDialog.displayView();
                }
                break;
              }
            }

            if (!recoveredHome) {
              home.addPropertyChangeListener("MODIFIED", homeModificationListener);
              home.addPropertyChangeListener("NAME", homeNameModificationListener);
              if (home.isModified()) {
                manager.saveRecoveredHomes();
                manager.restartTimer();
              }
            }
          },
          homesError: function (status, error) {
            console.log("Couldn't retrieve homes from database : " + status + " " + error);
          },
          homeNamesEqual: function (name1, name2) {
            // If both names ends by a home extension
            const name1Extension1Index = name1.indexOf(homeExtension1, name1.length - homeExtension1.length);
            const name1Extension2Index = name1.indexOf(homeExtension2, name1.length - homeExtension2.length);
            const name2Extension1Index = name2.indexOf(homeExtension1, name2.length - homeExtension1.length);
            const name2Extension2Index = name2.indexOf(homeExtension2, name2.length - homeExtension2.length);
            if ((name1Extension1Index > 0 || name1Extension2Index > 0)
              && (name2Extension1Index > 0 || name2Extension2Index > 0)) {
              const name1WithoutExtension = name1Extension1Index > 0
                ? name1.substring(0, name1Extension1Index)
                : name1.substring(0, name1Extension2Index);
              const name2WithoutExtension = name2Extension1Index > 0
                ? name2.substring(0, name2Extension1Index)
                : name2.substring(0, name2Extension2Index);
              return name1WithoutExtension === name2WithoutExtension;
            } else {
              return name1 === name2;
            }
          }
        });
      } else if (ev.getType() == CollectionEvent.Type.DELETE
        && home.getName() != null) {
        if (manager.recoveredHomeNames.indexOf(home.getName()) >= 0) {
          manager.recoveredHomeNames.splice(manager.recoveredHomeNames.indexOf(home.getName()), 1);
          manager.deleteRecoveredHome(home.getName());
        }
        home.removePropertyChangeListener("MODIFIED", homeModificationListener);
      }
    };
    application.addHomesListener(homesListener);

    this.lastAutoSaveTime = Date.now();
    application.getUserPreferences().addPropertyChangeListener("AUTO_SAVE_DELAY_FOR_RECOVERY", (ev) => {
      manager.restartTimer();
    });
    this.restartTimer();
  }

  /**
   * Saves now modified document in auto recovery.
   * @ignore
   */
  saveRecoveredHomes() {
    const homes = this.application.getHomes();
    for (let i = 0; i < homes.length; i++) {
      const home = homes[i];
      if (home.getName() != null) {
        if (home.isModified()) {
          this.autoSaveRecorder.writeHome(home, home.getName(), {
            homeSaved: function (home) {
            },
            homeError: function (status, error) {
              console.log("Couldn't save home for recovery : " + status + " " + error);
            }
          });
        } else if (this.recoveredHomeNames.indexOf(home.getName()) < 0) {
          this.deleteRecoveredHome(home.getName());
        }
      }
    }
    this.lastAutoSaveTime = Math.max(this.lastAutoSaveTime, Date.now());
  }

  /**
   * Restarts the timer that regularly saves application homes.
   * @ignore
   */
  restartTimer() {
    const manager = this;
    this.stopTimer();
    const autoSaveDelayForRecovery = this.application.getUserPreferences().getAutoSaveDelayForRecovery();
    if (autoSaveDelayForRecovery > 0) {
      const autoSaveTask = () => {
        if (Date.now() - manager.lastAutoSaveTime > 5000) {
          manager.saveRecoveredHomes();
        }
      };
      this.timerIntervalId = setInterval(autoSaveTask, autoSaveDelayForRecovery);
    }
  }

  /**
   * Restarts the timer that regularly saves application homes.
   * @ignore
   */
  stopTimer() {
    if (this.timerIntervalId) {
      window.clearInterval(this.timerIntervalId);
      delete this.timerIntervalId;
    }
  }

  /**
   * Deletes the given home form auto recovery database.
   * @private
   */
  deleteRecoveredHome(homeName) {
    const manager = this;
    this.autoSaveRecorder.deleteHome(homeName, {
      homeDeleted: function () {
        if (manager.recoveredHomeNames.length == 0) {
          // Remove all data if no homes are left in Recovery database
          // except if an opened home was previously recovered (saving it again will make its data necessary)
          manager.autoSaveRecorder.getAvailableHomes({
            availableHomes: function (homeNames) {
              if (homeNames.length === 0) {
                const dummyRecorder = new DirectHomeRecorder({
                  listHomesURL: manager.autoRecoveryDatabaseUrlBase + "?name=.*",
                  deleteHomeURL: manager.autoRecoveryDatabaseUrlBase + "?name=%s"
                });
                dummyRecorder.getAvailableHomes({
                  availableHomes: function (dataNames) {
                    for (let i = 0; i < dataNames.length; i++) {
                      dummyRecorder.deleteHome(dataNames[i], { homeDeleted: function () { } });
                    }
                  }
                });
              }
            }
          });
        }
      }
    });
  }
}
