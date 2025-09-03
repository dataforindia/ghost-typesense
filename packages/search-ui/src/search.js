import Typesense from 'typesense';
import {
  AUTHOR_DETAILS,
  SEARCH_FIELDS,
  SEARCH_PARAMS,
  DEFAULT_POST_HITS_COUNT,
  POST_HITS_INCREMENT_COUNT,
} from "./constants";

(function () {
    let isInitialized = false;
    let observer = null;

    function cleanupGhostSearch() {
        // Only cleanup after we've initialized
        if (!isInitialized) return;

        const searchScript = document.querySelector('script[data-sodo-search]');
        if (searchScript) searchScript.remove();
        const searchRoot = document.getElementById('sodo-search-root');
        if (searchRoot) searchRoot.remove();
    }

    function setupCleanup() {
        // Setup observer only after we've initialized
        observer = new MutationObserver((mutations) => {
            if (!isInitialized) return;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.tagName === 'SCRIPT' && node.hasAttribute('data-sodo-search')) {
                            node.remove();
                        } else if (node.id === 'sodo-search-root') {
                            node.remove();
                        }
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        // Also set up periodic cleanup just in case
        const cleanupInterval = setInterval(cleanupGhostSearch, 100);
        // Stop checking after 5 seconds
        setTimeout(() => {
            clearInterval(cleanupInterval);
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        }, 15000);
    }

    // CSS class prefix to avoid conflicts
    const CSS_PREFIX = 'mp-search';

    // Inject styles directly into the page
    function injectStyles() {
        if (document.getElementById('mp-search-styles')) return;

        const style = document.createElement('style');
        style.id = 'mp-search-styles';
        style.textContent = BUNDLED_CSS;
        document.head.appendChild(style);
    }

    class MagicPagesSearch {
        constructor(config = {}) {
            if (isInitialized) {
                console.warn('MagicPagesSearch is already initialized');
                return window.magicPagesSearch;
            }

            this.isModalOpen = false;
            this.activeElement = null;
            this.scrollPosition = 0;

            const defaultConfig = window.__MP_SEARCH_CONFIG__ || {
                typesenseNodes: [{
                    host: 'localhost',
                    port: '8108',
                    protocol: 'http'
                }],
                typesenseApiKey: null,
                collectionName: null,
                commonSearches: [],
                theme: 'system',
                enableHighlighting: true,
                enableDidYouMean: true,
                searchFields: SEARCH_FIELDS
            };

            this.config = {
                ...defaultConfig,
                ...config,
                commonSearches: config.commonSearches || defaultConfig.commonSearches || []
            };

            if (!this.config.typesenseNodes || !this.config.typesenseApiKey || !this.config.collectionName) {
                throw new Error('MagicPagesSearch: Missing required Typesense configuration');
            }

            this.selectedIndex = -1;
            this.searchDebounceTimeout = null;
            this.cachedElements = {};

            this.init();
            isInitialized = true;
        }

        async init() {
            injectStyles();
            await this.createSearchModal();
            this.initEventListeners();
            this.setupHashHandling();
            await this.handleInitialState();
        }

        async createSearchModal() {
            // Check if modal already exists
            if (document.getElementById(`${CSS_PREFIX}-modal`)) return;

            // Create modal container using portal pattern
            const modalHtml = `
                <div id="${CSS_PREFIX}-modal" class="${CSS_PREFIX}-modal ${CSS_PREFIX}-hidden" role="dialog" aria-modal="true" aria-label="Search">
                    <div class="${CSS_PREFIX}-backdrop"></div>
                    <div class="${CSS_PREFIX}-container">
                        <button class="${CSS_PREFIX}-close" aria-label="Close search">
                            <span aria-hidden="true">×</span>
                        </button>
                        <div class="${CSS_PREFIX}-content">
                            <div class="${CSS_PREFIX}-header">
                                <div id="${CSS_PREFIX}-searchbox" role="search">
                                    <form class="${CSS_PREFIX}-form" role="search">
                                        <input 
                                            type="search" 
                                            class="${CSS_PREFIX}-input" 
                                            placeholder="Search posts, topics and authors.."
                                            autocomplete="off"
                                            autocorrect="off"
                                            autocapitalize="off"
                                            spellcheck="false"
                                            maxlength="512"
                                            aria-label="Search"
                                        />
                                    </form>
                                </div>
                            </div>
                            <div class="${CSS_PREFIX}-results-container">
                                <div id="${CSS_PREFIX}-hits" class="${CSS_PREFIX}-hits-list" role="region" aria-label="Search results"></div>
                                <div id="${CSS_PREFIX}-loading" class="${CSS_PREFIX}-loading ${CSS_PREFIX}-hidden" role="status" aria-live="polite">
                                    <div class="${CSS_PREFIX}-spinner" aria-hidden="true"></div>
                                    <div>Searching...</div>
                                </div>
                                <div id="${CSS_PREFIX}-empty" class="${CSS_PREFIX}-empty ${CSS_PREFIX}-hidden" role="status" aria-live="polite">
                                    <div class="${CSS_PREFIX}-empty-message">
                                        <p>No matches found</p>
                                    </div>
                                </div>
                                ${this.getCommonSearchesHtml()}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Append to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // Cache elements
            this.modal = document.getElementById(`${CSS_PREFIX}-modal`);
            this.searchInput = this.modal.querySelector(`.${CSS_PREFIX}-input`);
            this.searchForm = this.modal.querySelector(`.${CSS_PREFIX}-form`);
            this.hitsList = this.modal.querySelector(`#${CSS_PREFIX}-hits`);
            this.commonSearches = this.modal.querySelector(`.${CSS_PREFIX}-common-searches`);
            this.loadingState = this.modal.querySelector(`#${CSS_PREFIX}-loading`);
            this.emptyState = this.modal.querySelector(`#${CSS_PREFIX}-empty`);

            // Handle dark mode
            // this.updateTheme();
        }

        getCommonSearchesHtml() {
            if (!this.config.commonSearches?.length) {
                return `
                    <div class="${CSS_PREFIX}-common-searches">
                        <div class="${CSS_PREFIX}-empty-message">Start typing to search...</div>
                    </div>
                `;
            }

            return `
                <div class="${CSS_PREFIX}-common-searches">
                    <div class="result-group-header" role="heading" aria-level="2">
                        Featured searches
                    </div>
                    <div id="${CSS_PREFIX}-common-searches-container" role="list">
                        ${this.config.commonSearches.map(search => `
                            <button type="button" 
                                class="${CSS_PREFIX}-common-search-btn" 
                                data-search="${search}"
                                role="listitem">
                                ${search}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        updateTheme() {
            const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.modal.classList.toggle(`${CSS_PREFIX}-dark`, isDarkMode);
        }

        initEventListeners() {
            // Close button
            const closeButton = this.modal.querySelector(`.${CSS_PREFIX}-close`);
            closeButton.addEventListener('click', () => this.closeModal());

            // Click outside to close
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal || e.target.classList.contains(`${CSS_PREFIX}-backdrop`)) {
                    this.closeModal();
                }
            });

            // Prevent clicks on modal content from closing
            const modalContent = this.modal.querySelector(`.${CSS_PREFIX}-container`);
            modalContent.addEventListener('click', (e) => e.stopPropagation());

            // Search form submission
            this.searchForm.addEventListener('submit', (e) => {
                e.preventDefault();
            });

            // Search input
            this.searchInput.addEventListener('input', (e) => {
                const query = e.target.value;

                // Clear any pending search
                if (this.searchDebounceTimeout) {
                    clearTimeout(this.searchDebounceTimeout);
                }

                // Debounce search
                this.searchDebounceTimeout = setTimeout(() => {
                    this.handleSearch(query);
                }, 80);
            });

            // Common searches
            this.attachCommonSearchListeners();

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                // Cmd/Ctrl + K to open
                if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                    e.preventDefault();
                    this.openModal();
                }
                
                // / to open (when not in input)
                if (e.key === '/' && !e.ctrlKey && !e.metaKey &&
                    e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.openModal();
                }
                
                // Escape to close
                if (e.key === 'Escape' && this.isModalOpen) {
                    e.preventDefault();
                    this.closeModal();
                }
            });

            // Handle keyboard navigation in modal
            this.modal.addEventListener('keydown', (e) => this.handleKeydown(e));

            // Handle Ghost's search buttons
            document.querySelectorAll('[data-ghost-search]').forEach(button => {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openModal();
                });
            });

            // Handle theme changes
            // window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            //     this.updateTheme();
            // });
        }

        attachCommonSearchListeners() {
            const container = this.modal.querySelector(`#${CSS_PREFIX}-common-searches-container`);
            if (!container) return;

            const handleClick = (e) => {
                const btn = e.target.closest(`.${CSS_PREFIX}-common-search-btn`);
                if (!btn) return;

                e.preventDefault();
                const searchTerm = btn.dataset.search;

                if (this.searchInput) {
                    this.selectedIndex = -1;
                    this.searchInput.value = searchTerm;
                    this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    setTimeout(() => {
                        this.searchInput.focus();
                        this.searchInput.setSelectionRange(searchTerm.length, searchTerm.length);
                    }, 0);
                }
            };

            container.addEventListener('click', handleClick);
            container.addEventListener('touchend', handleClick);
        }

        lockBodyScroll() {
            // Store current scroll position
            this.scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
            
            // Apply body lock styles
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.top = `-${this.scrollPosition}px`;
            document.body.style.width = '100%';
        }

        unlockBodyScroll() {
            // Remove body lock styles
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('position');
            document.body.style.removeProperty('top');
            document.body.style.removeProperty('width');
            
            // Restore scroll position
            window.scrollTo(0, this.scrollPosition);
        }

        async openModal() {
            if (this.isModalOpen) return;

            // Store active element for focus restoration
            this.activeElement = document.activeElement;

            // Show modal
            this.modal.classList.remove(`${CSS_PREFIX}-hidden`);
            this.isModalOpen = true;

            // Lock body scroll
            this.lockBodyScroll();

            // Focus search input
            setTimeout(() => {
                this.searchInput.focus();
            }, 50);

            // Update URL
            if (window.location.hash !== '#/search') {
                history.replaceState(null, null, `${window.location.pathname}${window.location.search}#/search`);
            }

            // Check for search query parameters
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');
            
            if (searchQuery && this.searchInput) {
                this.searchInput.value = searchQuery;
                this.handleSearch(searchQuery);
            }
        }

        closeModal() {
            if (!this.isModalOpen) return;

            // Hide modal
            this.modal.classList.add(`${CSS_PREFIX}-hidden`);
            this.isModalOpen = false;

            // Unlock body scroll
            this.unlockBodyScroll();

            // Clear search
            this.selectedIndex = -1;
            if (this.searchInput) {
                this.searchInput.value = '';
            }
            this.handleSearch('');

            // Restore focus
            if (this.activeElement && typeof this.activeElement.focus === 'function') {
                this.activeElement.focus();
            }

            // Update URL
            if (window.location.hash === '#/search') {
                history.replaceState(null, null, `${window.location.pathname}${window.location.search}`);
            }
        }

        getResultsHtml(results) {
            const initialHits = results.slice(0, DEFAULT_POST_HITS_COUNT).map(this.renderPostHit).join("");
            const hasMore = results.length > DEFAULT_POST_HITS_COUNT;
            return `
                <div class="post-results">
                <h3 class="result-group-header">Posts</h3>
                <span id="post-hits">${initialHits}</span>
                ${hasMore ? `<div id="show-more-container" class="show-more-container"><button id="show-more-results" aria-controls="post-hits">Show More Results</button></div>` : ""}
                </div>
            `;
        }

        renderPostHit = (hit) => {
            const title = hit.highlight.title?.snippet || hit.document.title || "Untitled";
            const excerpt =
                hit.highlight.excerpt?.snippet ||
                hit.highlight.plaintext?.snippet ||
                hit.document.excerpt ||
                hit.document.plaintext ||
                "";

            return `
                <a href="${hit.document.url || "#"}" class="${CSS_PREFIX}-result-link">
                    <article class="${CSS_PREFIX}-result-item">
                        <h3 class="${CSS_PREFIX}-result-title">${title}</h3>
                        <p class="${CSS_PREFIX}-result-excerpt">${excerpt}...</p>
                    </article>
                </a>
            `;
        };

        updatePostHits(results, limit) {
            const container = document.getElementById("post-hits");
            if (!container) return;

            const nextHits = results.slice(this.currentHitIndex, this.currentHitIndex + limit);
            container.insertAdjacentHTML("beforeend", nextHits.map(this.renderPostHit).join(""));
            this.currentHitIndex += limit;

            // hide button
            const showMoreBtn = document.getElementById("show-more-container");
            if (this.currentHitIndex >= results.length && showMoreBtn) {
                showMoreBtn.style.display = "none";
            }
        }

        async handleSearch(query) {
            query = query?.trim();

            if (!query) {
                this.selectedIndex = -1;
                if (this.hitsList) {
                    this.hitsList.classList.add(`${CSS_PREFIX}-hidden`)
                    this.hitsList.innerHTML = '';
                }
                if (this.commonSearches) this.commonSearches.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                return;
            }

            // Update UI immediately
            if (this.commonSearches) this.commonSearches.classList.add(`${CSS_PREFIX}-hidden`);
            if (this.hitsList) this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            if (this.loadingState) this.loadingState.classList.remove(`${CSS_PREFIX}-hidden`);
            if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);

            try {
                // Initialize Typesense client if not already initialized
                if (!this.typesenseClient) {
                    this.typesenseClient = new Typesense.Client({
                        nodes: this.config.typesenseNodes,
                        apiKey: this.config.typesenseApiKey,
                        connectionTimeoutSeconds: 2
                    });
                }

                const searchParams = this.getSearchParameters();
                const searchParameters = {
                    q: query,
                    ...(query.includes('"') ? {} : { stopwords: "common-english" }),
                    ...searchParams
                };

                const results =  await this.typesenseClient
                    .collections(this.config.collectionName)
                    .documents()
                    .search(searchParameters);
                // window.localStorage.setItem('resultsLog', JSON.stringify(results))

                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);

                if (results.hits.length === 0) {
                    if (this.emptyState) this.emptyState.classList.remove(`${CSS_PREFIX}-hidden`);
                    if (this.hitsList) {
                        this.hitsList.innerHTML = '';
                        this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                    }
                    return;
                }
                
                if (this.emptyState) this.emptyState.classList.add(`${CSS_PREFIX}-hidden`);
                
                // Clear and populate results
                this.hitsList.innerHTML = '';
                this.currentHitIndex = DEFAULT_POST_HITS_COUNT;
                const resultsHtml = this.getResultsHtml(results.hits)

                let intervalTimer = 0;
                const interval = setInterval(() => {
                  const showMoreBtn = document.getElementById("show-more-container");
                  if (showMoreBtn) {
                    showMoreBtn.addEventListener("click", () => {
                      this.updatePostHits(results.hits, POST_HITS_INCREMENT_COUNT);
                    });
                    clearInterval(interval);
                  }
                  intervalTimer += 100;
                  if (intervalTimer >= 5000) clearInterval(interval);
                }, 100);

                let tagsHtml = "";
                try {
                  const allTags = [
                    ...new Set(
                      results.hits.flatMap((hit) => hit.document["tags.name"])
                    ),
                  ]
                    .filter((tag) => !tag.includes("#"))
                    .slice(0, 3);
                  tagsHtml = `<div class="tag-results">
                    <h3 class="result-group-header">Topics</h3>
                    ${allTags.map((tag) => `<div class="tag-result-item"><p class="tag-list-marker">#</p><a href="${window.location.origin}/tag/${tag}">${tag}</a></div>`).join("")}
                    </div>`;
                } catch {
                    console.log('failed to set tags results')
                }

                let authorsHtml = ''
                try {
                    const allAuthors = [
                      ...new Set(
                        results.hits.flatMap((hit) => hit.document["authors"])
                      ),
                    ]
                      .filter((author) => AUTHOR_DETAILS[author])
                      .slice(0, 3);
                    authorsHtml = `
                        <div class="author-results">
                            <h3 class="result-group-header">Authors</h3>
                            ${allAuthors
                            .map(
                                (author) =>
                                `<div class="author-result-item"><img src="${AUTHOR_DETAILS[author]?.image}" /><a href="${window.location.origin}/author/${AUTHOR_DETAILS[author].slug}">${author}</a></div>`
                            )
                            .join("")}
                        </div>
                    `;
                } catch {
                    console.log('failed to set authors results')
                }
                
                this.hitsList.innerHTML = resultsHtml + tagsHtml + authorsHtml ;
                this.hitsList.classList.remove(`${CSS_PREFIX}-hidden`);
            } catch (error) {
                console.error('Search failed:', error);
                if (this.loadingState) this.loadingState.classList.add(`${CSS_PREFIX}-hidden`);
                if (this.emptyState) this.emptyState.classList.remove(`${CSS_PREFIX}-hidden`);
                if (this.hitsList) {
                    this.hitsList.innerHTML = '';
                    this.hitsList.classList.add(`${CSS_PREFIX}-hidden`);
                }
            }
        }

        getSearchParameters() {
            const fields = Object.keys(this.config.searchFields || {}).length > 0
                ? this.config.searchFields
                : SEARCH_FIELDS;

            const searchFields = [];
            const weights = [];
            const highlightFields = [];

            Object.entries(fields).forEach(([field, config]) => {
                searchFields.push(field);
                weights.push(config.weight || 1);
                if (config.highlight) {
                    highlightFields.push(field);
                }
            });

            return {
                query_by: searchFields.join(','),
                query_by_weights: weights.join(','),
                highlight_full_fields: highlightFields.join(','),
                include_fields: 'title,url,excerpt,plaintext,updated_at,published_at,tags,authors,headings',
                ...SEARCH_PARAMS
            };
        }

        handleKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.closeModal();
                return;
            }

            if (e.target !== this.searchInput) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateResults('next');
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateResults('prev');
                    break;
                case 'Enter':
                    if (this.selectedIndex !== -1) {
                        e.preventDefault();
                        this.handleEnterKey();
                    }
                    break;
            }
        }

        navigateResults(direction) {
            const results = [...this.modal.querySelectorAll(`.${CSS_PREFIX}-result-link, .${CSS_PREFIX}-common-search-btn:not(.${CSS_PREFIX}-hidden)`)].filter(
                el => el.offsetParent !== null && !el.closest(`.${CSS_PREFIX}-hidden`)
            );

            if (results.length === 0) return;

            if (this.selectedIndex === -1) {
                this.selectedIndex = direction === 'next' ? 0 : results.length - 1;
            } else {
                this.selectedIndex = direction === 'next'
                    ? (this.selectedIndex + 1) % results.length
                    : (this.selectedIndex - 1 + results.length) % results.length;
            }

            results.forEach(result => result.classList.remove(`${CSS_PREFIX}-selected`));
            const selectedElement = results[this.selectedIndex];
            selectedElement.classList.add(`${CSS_PREFIX}-selected`);
            selectedElement.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }

        handleEnterKey() {
            const results = [...this.modal.querySelectorAll(`.${CSS_PREFIX}-result-link, .${CSS_PREFIX}-common-search-btn:not(.${CSS_PREFIX}-hidden)`)].filter(
                el => el.offsetParent !== null && !el.closest(`.${CSS_PREFIX}-hidden`)
            );

            if (this.selectedIndex >= 0 && this.selectedIndex < results.length) {
                const selectedElement = results[this.selectedIndex];
                if (selectedElement.classList.contains(`${CSS_PREFIX}-result-link`)) {
                    window.location.href = selectedElement.href;
                } else {
                    this.searchInput.value = selectedElement.textContent.trim();
                    this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }

        setupHashHandling() {
            window.addEventListener('hashchange', () => this.syncWithHash());
        }

        async syncWithHash() {
            const isSearchHash = window.location.hash.startsWith('#/search');
            
            if (isSearchHash !== this.isModalOpen) {
                if (isSearchHash) {
                    await this.openModal();
                } else {
                    this.closeModal();
                }
            }
        }

        async handleInitialState() {
            // Check for search query parameters in the URL
            const searchParams = new URLSearchParams(window.location.search);
            const searchQuery = searchParams.get('s') || searchParams.get('q');
            
            // Check for search terms in the hash path
            const hashParts = window.location.hash.split('/');
            let hashQuery = null;
            
            if (hashParts.length > 2 && hashParts[1] === 'search') {
                hashQuery = decodeURIComponent(hashParts[2]).replace(/\+/g, ' ');
            }
            
            // Prioritize hash query over URL query
            if (hashQuery) {
                await this.openModal();
                if (this.searchInput) {
                    this.searchInput.value = hashQuery;
                    this.handleSearch(hashQuery);
                }
            } else if (searchQuery) {
                await this.openModal();
                if (this.searchInput) {
                    this.searchInput.value = searchQuery;
                    this.handleSearch(searchQuery);
                }
            } else if (window.location.hash === '#/search') {
                await this.openModal();
            }
        }
    }

    // Export to window
    window.MagicPagesSearch = MagicPagesSearch;

    // Auto-initialize function
    function initializeSearch() {
        // Check for search query parameters
        const searchParams = new URLSearchParams(window.location.search);
        const hasSearchParam = searchParams.has('s') || searchParams.has('q');
        
        if (!window.magicPagesSearch && (
            window.__MP_SEARCH_CONFIG__ ||
            window.location.hash === '#/search' ||
            hasSearchParam ||
            document.querySelectorAll('[data-ghost-search]').length > 0
        )) {
            window.magicPagesSearch = new MagicPagesSearch();
            // Only after successful initialization, start cleaning up Ghost's search
            setupCleanup();
        }
    }

    // Wait for document.body before initializing
    function waitForBody() {
        return new Promise(resolve => {
            if (document.body) {
                resolve();
            } else {
                const observer = new MutationObserver(() => {
                    if (document.body) {
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(document.documentElement, { childList: true });
            }
        });
    }

    // Try to initialize immediately if body exists
    waitForBody().then(initializeSearch);

    // Also try again on DOMContentLoaded just in case
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSearch);
    }
})(); 