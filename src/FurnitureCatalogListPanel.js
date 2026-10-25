/*
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
} from './SweetHome3D';

import { ResourceAction } from './ResourceAction';
import { TextureManager } from './TextureManager';
import { CoreTools } from './CoreTools';
import { OperatingSystem } from './URLContent';

/** Placeholder partagé (évite canvas×N à chaque rebuild catalogue). */
const FURNITURE_ICON_PLACEHOLDER_SRC =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
      '<rect fill="#ced4da" width="128" height="128"/>' +
      '<text x="64" y="78" text-anchor="middle" font-size="52" font-family="sans-serif" font-weight="bold" fill="#495057">?</text>' +
    '</svg>'
  );

const CATALOG_BUILD_CHUNK = 40;

/**
 * Creates a panel that displays <code>catalog</code> furniture in a list.
 * @constructor
 * @author Emmanuel Puybaret
 * @author Renaud Pawlak
 */
export class FurnitureCatalogListPanel {
  constructor(containerId, catalog, preferences, controller) {
    this.container = document.getElementById(containerId);
    this.controller = controller;
    this.preferences = preferences;
    this._iconObserver = null;
    this._resetGeneration = 0;
    this.createComponents(catalog, preferences, controller);
  }

  /**
   * Returns the HTML element used to view this component at screen.
   */
  getHTMLElement() {
    return this.container;
  }

  /**
   * Creates the components displayed by this panel.
   * @private
   */
  createComponents(catalog, preferences, controller) {
    let furnitureCatalogListPanel = this;
    let furnitureCatalogList = this.container.getElementsByClassName("furniture-catalog-list")[0];
    this.catalog = catalog;

    this.toolTipDiv = document.createElement("div");
    this.toolTipDiv.classList.add("furniture-tooltip");
    this.toolTipDiv.style.display = "none";
    this.toolTipDiv.style.position = "absolute";
    document.body.appendChild(this.toolTipDiv);

    // Filtering
    let filteringDiv = document.createElement("div");
    filteringDiv.id = "furniture-filter";
    this.container.insertBefore(filteringDiv, furnitureCatalogList);

    let categorySelector = document.createElement("select");
    this.categorySelector = categorySelector;
    let searchInput = document.createElement("input");
    this.searchInput = searchInput;
    let filterChangeHandler = () => {
      let valueToSearch = CoreTools.removeAccents(searchInput.value.trim()).replace(/[.*+?^${}()|[\]\\]/g, ' ');
      let wordsToSearch = valueToSearch.split(' ');
      furnitureCatalogListPanel.filterCatalog(categorySelector.selectedIndex, (piece) => {
        if (valueToSearch == "") {
          return true;
        } else {
          let pieceDescriptor = piece.getName() + "|" + piece.getCategory().getName() + "|" + piece.getTags().join("|");
          if (piece.getCreator() !== null) {
            pieceDescriptor += "|" + piece.getCreator();
          }
          pieceDescriptor = CoreTools.removeAccents(pieceDescriptor);
          for (let i = 1; i < wordsToSearch.length; i++) {
            if (!RegExp(wordsToSearch[i], "i").test(pieceDescriptor)) {
              return false;
            };
          }
          return RegExp(wordsToSearch[0], "i").test(pieceDescriptor);
        }
      });
    };
    categorySelector.id = "furniture-category-select";
    let noCategoryOption = document.createElement("option");
    let noCategory = preferences.getLocalizedString("FurnitureCatalogListPanel", "categoryFilterComboBox.noCategory");
    noCategoryOption.value =
      noCategoryOption.text = noCategory;
    categorySelector.appendChild(noCategoryOption);
    for (let i = 0; i < catalog.getCategories().length; i++) {
      var categoryOption = document.createElement("option");
      categoryOption.value =
        categoryOption.text = catalog.getCategories()[i].getName();
      categorySelector.appendChild(categoryOption);
    }
    categorySelector.addEventListener("change", filterChangeHandler);
    categorySelector.addEventListener("mousemove", (ev) => {
      furnitureCatalogListPanel.hideTooltip();
      ev.stopPropagation();
    });
    filteringDiv.appendChild(categorySelector);
    searchInput.setAttribute('type', 'text');
    searchInput.id = "furniture-search-field";
    searchInput.placeholder = ResourceAction.getLocalizedLabelText(preferences, "FurnitureCatalogListPanel", "searchLabel.text").replace(":", "");
    searchInput.addEventListener("input", filterChangeHandler);
    searchInput.addEventListener("mousemove", (ev) => {
      furnitureCatalogListPanel.hideTooltip();
      ev.stopPropagation();
    });
    furnitureCatalogList.addEventListener("click", (ev) => {
      let bounds = searchInput.getBoundingClientRect();
      if (!(ev.clientX >= bounds.left && ev.clientX <= bounds.right
        && ev.clientY >= bounds.top && ev.clientY <= bounds.bottom)) {
        furnitureCatalogListPanel.searchInput.blur();
      }
    });
    searchInput.addEventListener("focusin", (ev) => {
      searchInput.classList.remove("partly-expanded");
      if (!searchInput.classList.contains("expanded")) {
        searchInput.classList.add("expanded");
        setTimeout(() => {
          if (searchInput.value != "") {
            searchInput.select();
          }
          if (document.body.scrollTop == 0) {
            // Device did not scroll automatically, so we have to force it to show the search field
            window.scrollTo(0, furnitureCatalogListPanel.container.getBoundingClientRect().top);
          }
        }, 100);
      }
    });
    searchInput.addEventListener("focusout", (ev) => {
      if (searchInput.classList.contains("expanded")) {
        searchInput.classList.remove("expanded");
        if (searchInput.value.trim() != "") {
          searchInput.classList.add("partly-expanded");
        }
      }
    });
    searchInput.addEventListener("keydown", (ev) => {
      if (ev.keyCode == 27) {
        searchInput.value = "";
        var ev = document.createEvent("Event");
        ev.initEvent("input", true, true);
        searchInput.dispatchEvent(ev);
      }
      ev.stopPropagation();
    });
    filteringDiv.appendChild(searchInput);

    // Create catalog
    this.resetFurnitureCatalog(catalog);

    // Tooltip management
    let currentFurnitureContainer;
    window.addEventListener("mousemove", (ev) => {
      let panelBounds = furnitureCatalogListPanel.container.getBoundingClientRect();
      let coords = ev;
      if ((coords.clientX >= panelBounds.left) && (coords.clientX < panelBounds.left + panelBounds.width)
        && (coords.clientY >= panelBounds.top) && (coords.clientY < panelBounds.top + panelBounds.height)) {
        if (furnitureCatalogListPanel.toolTipDiv.style.display == "none") {
          if (furnitureCatalogListPanel.showTooltipTimeout) {
            clearTimeout(furnitureCatalogListPanel.showTooltipTimeout);
          }
          furnitureCatalogListPanel.showTooltipTimeout = setTimeout(() => {
            if (furnitureCatalogListPanel.currentFurnitureContainer !== undefined) {
              currentFurnitureContainer = furnitureCatalogListPanel.currentFurnitureContainer;
              furnitureCatalogListPanel.showTooltip(currentFurnitureContainer, ev);
              if (!furnitureCatalogListPanel.hideTooltipTimeout) {
                furnitureCatalogListPanel.hideTooltipTimeout = setTimeout(() => {
                  furnitureCatalogListPanel.hideTooltip();
                }, 3000);
              }
            }
          }, 1000);
        } else {
          if (currentFurnitureContainer !== furnitureCatalogListPanel.currentFurnitureContainer) {
            currentFurnitureContainer = furnitureCatalogListPanel.currentFurnitureContainer;
            furnitureCatalogListPanel.showTooltip(currentFurnitureContainer, ev);
          }
          if (furnitureCatalogListPanel.hideTooltipTimeout) {
            clearTimeout(furnitureCatalogListPanel.hideTooltipTimeout);
          }
          furnitureCatalogListPanel.hideTooltipTimeout = setTimeout(() => {
            furnitureCatalogListPanel.hideTooltip();
          }, 3000);
        }
      } else {
        furnitureCatalogListPanel.currentFurnitureContainer = undefined;
        furnitureCatalogListPanel.hideTooltip();
      }
    });

    furnitureCatalogList.addEventListener("mouseleave", (ev) => {
      furnitureCatalogListPanel.hideTooltip();
    });

    this.languageChangeListener = ev => {
      let searchInput = document.getElementById("furniture-search-field");
      searchInput.placeholder = ResourceAction.getLocalizedLabelText(preferences, "FurnitureCatalogListPanel", "searchLabel.text").replace(":", "");
      let noCategory = preferences.getLocalizedString("FurnitureCatalogListPanel", "categoryFilterComboBox.noCategory");
      noCategoryOption.value =
        noCategoryOption.text = noCategory;
    };
    preferences.addPropertyChangeListener("LANGUAGE", this.languageChangeListener);
    catalog.addFurnitureListener((ev) => {
      let category = ev.getItem().getCategory();
      let categories = catalog.getCategories();
      let children = categorySelector.childNodes;
      if (categories.indexOf(category) === -1) {
        for (var i = 0; i < children.length; i++) {
          if (children[i].value == category.getName()) {
            categorySelector.removeChild(children[i]);
            break;
          }
        }
      } else if (ev.getType() === CollectionEvent.Type.ADD) {
        let insertIndex = children.length;
        for (var i = 1; i < children.length; i++) { // Start at index 1 to keep noCategory option first
          if (children[i].value == category.getName()) {
            insertIndex = -1;
            break;
          } else if (children[i].value > category.getName()) {
            insertIndex = i;
            break;
          }
        }
        if (insertIndex >= 0) {
          categoryOption = document.createElement("option");
          categoryOption.value =
            categoryOption.text = category.getName();
          if (insertIndex === children.length) {
            categorySelector.appendChild(categoryOption);
          } else {
            categorySelector.insertBefore(categoryOption, children[insertIndex]);
          }
        }
      }

      if (!furnitureCatalogListPanel.furnitureCatalogUpdater) {
        furnitureCatalogListPanel.furnitureCatalogUpdater = () => {
          furnitureCatalogListPanel.resetFurnitureCatalog(catalog);
          delete furnitureCatalogListPanel.furnitureCatalogUpdater;
        };
        setTimeout(furnitureCatalogListPanel.furnitureCatalogUpdater, 0);
      }
    });
  }

  /**
   * @private
   */
  findCategoryElements(category) {
    let elements = [];
    let furnitureCatalogList = this.container.getElementsByClassName("furniture-catalog-list")[0];
    for (let i = 0; i < furnitureCatalogList.childNodes.length; i++) {
      if (furnitureCatalogList.childNodes[i].category === category) {
        elements.push(furnitureCatalogList.childNodes[i]);
      }
    }
    return elements;
  }

  /**
   * @private
   */
  filterCatalog(categoryIndex, pieceFilter) {
    // First hide all elements (save display value for further restoring)
    let furnitureCatalogList = this.container.getElementsByClassName("furniture-catalog-list")[0];
    for (var i = 0; i < furnitureCatalogList.childNodes.length; i++) {
      if (furnitureCatalogList.childNodes[i] instanceof HTMLElement
        && furnitureCatalogList.childNodes[i].id !== "furniture-filter") {
        if (furnitureCatalogList.childNodes[i]._displayBackup === undefined) {
          furnitureCatalogList.childNodes[i]._displayBackup = furnitureCatalogList.childNodes[i].style.display;
        }
        furnitureCatalogList.childNodes[i].style.display = "none";
      }
    }

    // Show all elements that are not filtered out
    let categories = categoryIndex == null || categoryIndex === 0
      ? this.catalog.getCategories()
      : [this.catalog.getCategories()[categoryIndex - 1]];
    for (var i = 0; i < categories.length; i++) {
      let category = categories[i];
      const furniture = pieceFilter == null
        ? category.getFurniture()
        : category.getFurniture().filter(pieceFilter);
      if (furniture != null && furniture.length > 0) {
        let elements = this.findCategoryElements(category);
        elements.forEach((element) => {
          if (categories.length > 1
            && (element.classList.contains("furniture-category-label")
              || element.classList.contains("furniture-category-separator"))) {
            element.style.display = element._displayBackup;
          }
          if (element.piece && furniture.indexOf(element.piece) !== -1) {
            element.style.display = element._displayBackup;
          }
        });
      }
    }
  }

  /**
   * @private
   */
  disposeIconObserver() {
    if (this._iconObserver) {
      try {
        this._iconObserver.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._iconObserver = null;
    }
  }

  /**
   * Observer : charge l'icône réelle seulement quand la vignette entre dans le viewport.
   * @private
   */
  ensureIconObserver() {
    if (this._iconObserver || typeof IntersectionObserver === "undefined") {
      return this._iconObserver;
    }
    const panel = this;
    this._iconObserver = new IntersectionObserver(
      (entries) => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (!entry.isIntersecting) continue;
          const pieceContainer = entry.target;
          panel._iconObserver.unobserve(pieceContainer);
          panel.loadPieceIcon(pieceContainer);
        }
      },
      {
        root: this.container.getElementsByClassName("furniture-catalog-list")[0] || null,
        rootMargin: "80px 0px",
        threshold: 0.01,
      }
    );
    return this._iconObserver;
  }

  /**
   * Charge la texture d'une vignette (après intersection).
   * @private
   */
  loadPieceIcon(pieceContainer) {
    if (!pieceContainer || pieceContainer._iconLoading || pieceContainer._iconLoaded) {
      return;
    }
    const piece = pieceContainer.piece;
    const placeholder = pieceContainer.querySelector("img.furniture-icon");
    if (piece == null || piece.icon == null || placeholder == null) {
      return;
    }
    pieceContainer._iconLoading = true;
    TextureManager.getInstance().loadTexture(piece.icon, {
      textureUpdated: function (image) {
        image.classList.add("furniture-icon");
        if (placeholder.parentNode === pieceContainer) {
          pieceContainer.replaceChild(image, placeholder);
        }
        pieceContainer._iconLoaded = true;
        pieceContainer._iconLoading = false;
      },
      textureError: function (error) {
        pieceContainer._iconLoading = false;
        console.warn("Image cannot be loaded", error);
      }
    });
  }

  /**
   * @private
   */
  clearFurnitureCatalog(catalog) {
    this.disposeIconObserver();
    let furnitureCatalogList = this.container.getElementsByClassName("furniture-catalog-list")[0];
    let children = furnitureCatalogList.getElementsByClassName("furniture-category-label");
    for (var i = children.length - 1; i >= 0; i--) {
      furnitureCatalogList.removeChild(children[i]);
    }
    children = furnitureCatalogList.getElementsByClassName("furniture");
    for (var i = children.length - 1; i >= 0; i--) {
      furnitureCatalogList.removeChild(children[i]);
    }
    children = furnitureCatalogList.getElementsByClassName("furniture-category-separator");
    for (var i = children.length - 1; i >= 0; i--) {
      furnitureCatalogList.removeChild(children[i]);
    }
  }

  /**
   * Rebuild catalogue par paquets pour ne pas bloquer / faire planter l'onglet
   * après import de grosses bibliothèques.
   * @private
   */
  resetFurnitureCatalog(catalog) {
    this.clearFurnitureCatalog();
    const generation = ++this._resetGeneration;
    const furnitureCatalogList = this.container.getElementsByClassName("furniture-catalog-list")[0];
    const jobs = [];

    for (let i = 0; i < catalog.getCategoriesCount(); i++) {
      const category = catalog.getCategories()[i];
      jobs.push({ type: "label", category });
      for (let j = 0; j < category.getFurnitureCount(); j++) {
        jobs.push({ type: "piece", category, piece: category.getFurniture()[j] });
      }
      if (i < catalog.getCategoriesCount() - 1) {
        jobs.push({ type: "separator", category });
      }
    }

    const panel = this;
    let offset = 0;

    const processChunk = () => {
      if (generation !== panel._resetGeneration) {
        return;
      }
      const end = Math.min(offset + CATALOG_BUILD_CHUNK, jobs.length);
      for (; offset < end; offset++) {
        const job = jobs[offset];
        if (job.type === "label") {
          const categoryLabel = document.createElement("div");
          categoryLabel.className = "furniture-category-label";
          categoryLabel.innerHTML = job.category.getName();
          categoryLabel.category = job.category;
          furnitureCatalogList.appendChild(categoryLabel);
        } else if (job.type === "separator") {
          const categorySeparator = document.createElement("div");
          categorySeparator.className = "furniture-category-separator";
          categorySeparator.category = job.category;
          furnitureCatalogList.appendChild(categorySeparator);
        } else {
          const pieceContainer = document.createElement("div");
          pieceContainer.pieceOfFurniture = job.piece;
          pieceContainer.className = "furniture";
          pieceContainer.innerHTML = '<div class="furniture-label">' + job.piece.getName() + '</div>';
          furnitureCatalogList.appendChild(pieceContainer);
          panel.createPieceOfFurniturePanel(pieceContainer, job.piece);
          pieceContainer.category = job.category;
          pieceContainer.piece = job.piece;
        }
      }
      if (offset < jobs.length) {
        requestAnimationFrame(processChunk);
      }
    };

    processChunk();
  }

  /**
   * @private
   */
  createPieceOfFurniturePanel(pieceContainer, piece) {
    let furnitureCatalogListPanel = this;

    pieceContainer.addEventListener("mousemove", (ev) => {
      furnitureCatalogListPanel.currentFurnitureContainer = pieceContainer;
    });
    pieceContainer.addEventListener("mousedown", (ev) => {
      if (ev.button === 0) {
        let furnitureElements = furnitureCatalogListPanel.container.querySelectorAll(".furniture");
        for (let k = 0; k < furnitureElements.length; k++) {
          furnitureElements[k].classList.remove("selected");
        }
        pieceContainer.classList.add("selected");
        furnitureCatalogListPanel.controller.setSelectedFurniture([piece]);
        furnitureCatalogListPanel.hideTooltip();
      }
    });

    let touchEndListener = ev => {
      let containerBounds = pieceContainer.getBoundingClientRect();
      // Check touchend event is still within the container bounds 
      if (ev.touches.length === 0 && ev.changedTouches.length === 1
        && ev.changedTouches[0].clientX >= containerBounds.left && ev.changedTouches[0].clientX < containerBounds.left + containerBounds.width
        && ev.changedTouches[0].clientY >= containerBounds.top && ev.changedTouches[0].clientY < containerBounds.top + containerBounds.height) {
        let furnitureElements = furnitureCatalogListPanel.container.querySelectorAll(".furniture");
        for (let k = 0; k < furnitureElements.length; k++) {
          furnitureElements[k].classList.remove("selected");
        }
        pieceContainer.classList.add("selected");
        furnitureCatalogListPanel.container.focus();
        furnitureCatalogListPanel.controller.setSelectedFurniture([piece]);
      }
    };
    if (OperatingSystem.isInternetExplorerOrLegacyEdge()
      && window.PointerEvent) {
      pieceContainer.addEventListener("pointerup", (ev) => {
        if (ev.pointerType != "mouse") {
          ev.touches = [];
          ev.changedTouches = [{ clientX: ev.clientX, clientY: ev.clientY }];
          touchEndListener(ev);
          ev.preventDefault();
        }
      });
      pieceContainer.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType != "mouse") {
          ev.preventDefault();
        }
      });
      let defaultListener = ev => {
        ev.preventDefault();
      };
      pieceContainer.addEventListener("mousedown", defaultListener);
    } else {
      pieceContainer.addEventListener("touchend", touchEndListener);
    }

    // Placeholder léger + chargement différé (IntersectionObserver) pour les grosses bibliothèques
    const placeholder = document.createElement("img");
    placeholder.classList.add("furniture-icon");
    placeholder.width = 128;
    placeholder.height = 128;
    placeholder.alt = piece.getName ? piece.getName() : "";
    placeholder.src = FURNITURE_ICON_PLACEHOLDER_SRC;
    placeholder.loading = "lazy";
    pieceContainer.appendChild(placeholder);

    if (piece.icon == null) {
      return;
    }
    const observer = this.ensureIconObserver();
    if (observer) {
      observer.observe(pieceContainer);
    } else {
      // Fallback sans IntersectionObserver
      this.loadPieceIcon(pieceContainer);
    }
  }

  /** 
   * @private 
   */
  showTooltip(pieceContainer, ev) {
    let pieceIcon = pieceContainer.querySelector("img.furniture-icon");
    if (pieceIcon !== null) {
      this.toolTipDiv.style.left = (ev.clientX + 10) + "px";
      this.toolTipDiv.style.top = (ev.clientY + 10) + "px";
      this.toolTipDiv.style.display = "block";
      this.toolTipDiv.innerHTML = this.createCatalogItemTooltipText(pieceContainer.pieceOfFurniture);
      let icon = this.toolTipDiv.querySelector("img");
      if (icon != null && pieceIcon.src) {
        icon.src = pieceIcon.src;
      }
      let toolTipBounds = this.toolTipDiv.getBoundingClientRect();
      if (toolTipBounds.x < 0) {
        this.toolTipDiv.style.left = (ev.clientX + 10 - toolTipBounds.x) + "px";
      }
      if (toolTipBounds.y < 0) {
        this.toolTipDiv.style.left = (ev.clientY + 10 - toolTipBounds.y) + "px";
      }
      if (toolTipBounds.x + Math.max(150, toolTipBounds.width) > window.innerWidth) {
        this.toolTipDiv.style.left = (window.innerWidth - Math.max(150, toolTipBounds.width)) + "px";
      }
      if (toolTipBounds.y + toolTipBounds.height > window.innerHeight) {
        this.toolTipDiv.style.top = (window.innerHeight - toolTipBounds.height) + "px";
      }
    } else {
      this.hideTooltip();
    }
  }

  /**
   * @private 
   */
  hideTooltip() {
    if (this.hideTooltipTimeout) {
      clearTimeout(this.hideTooltipTimeout);
      this.hideTooltipTimeout = undefined;
    }
    if (this.showTooltipTimeout) {
      clearTimeout(this.showTooltipTimeout);
      this.showTooltipTimeout = undefined;
    }
    if (this.toolTipDiv.style.display != "none") {
      this.toolTipDiv.style.display = "none";
    }
  }

  /** 
   * @private 
   */
  createCatalogItemTooltipText(piece) {
    if (this.preferences != null) {
      let creator = piece.getCreator();
      var tipTextCreator = null;
      if (creator != null && creator.length > 0) {
        tipTextCreator = this.preferences.getLocalizedString("CatalogItemToolTip", "tooltipCreator", creator);
      }
      let format = this.preferences.getLengthUnit().getFormatWithUnit();
      var tipTextDimensions = this.preferences.getLocalizedString("CatalogItemToolTip", "tooltipPieceOfFurnitureDimensions",
        format.format(piece.getWidth()), format.format(piece.getDepth()), format.format(piece.getHeight()));
      var tipTextModelSize = null;
      if (piece.getModelSize() != null && piece.getModelSize() > 0) {
        tipTextModelSize = this.preferences.getLocalizedString("CatalogItemToolTip", "tooltipModelSize",
          Math.max(1, Math.round(piece.getModelSize() / 1000)));
      }
    }

    let tipText = "<div>";
    tipText += "- <b>" + piece.getCategory().getName() + "</b> -<br>";
    tipText += "<b>" + piece.getName() + "</b>";
    if (tipTextDimensions != null) {
      tipText += "<br>" + tipTextDimensions;
    }
    if (tipTextModelSize != null) {
      tipText += "<br>" + tipTextModelSize;
    }
    if (tipTextCreator != null) {
      tipText += "<br>" + tipTextCreator;
    }
    tipText += "<br/><img height='100px'/>";
    tipText += "</div>";
    return tipText;
  }

  /** 
   * Removes components added to this panel and their listeners.
   */
  dispose() {
    this.preferences.removePropertyChangeListener("LANGUAGE", this.languageChangeListener);
    this._resetGeneration++;
    this.clearFurnitureCatalog();
    this.container.removeChild(document.getElementById("furniture-filter"));
    this.toolTipDiv.parentElement.removeChild(this.toolTipDiv);
  }
}
