<!-- TYPESENSE SEARCH -->
<script>
  window.__MP_SEARCH_CONFIG__ = {
    typesenseNodes: [{
      host: '',
      port: '443',
      protocol: 'https'
    }],
    typesenseApiKey: '',
    collectionName: 'ghost',
    theme: 'light',
    commonSearches: ['factories', 'manufacturing', 'employment']
  };
</script>

<script src="https://cdn.jsdelivr.net/gh/dataforindia/ghost-typesense@main/packages/search-ui/dist/search-v2.min.js"></script>

<script>
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
      // Initialize MagicPages
      if (window.MagicPagesSearch && !window.magicPagesSearch) {
        window.magicPagesSearch = new window.MagicPagesSearch();
      }

      // Override Ghost search button clicks
      document.querySelectorAll('[data-ghost-search]').forEach(button => {
        // Remove existing Ghost listeners
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);

        // Add MagicPages listener
        newButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.magicPagesSearch && window.magicPagesSearch.openModal) {
            window.magicPagesSearch.openModal();
          }
        });
      });
    }, 500);
  });
</script>
