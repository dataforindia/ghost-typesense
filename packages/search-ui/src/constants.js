export const SEARCH_VERSION = "1";

export const AUTHOR_DETAILS = {
  "Rukmini S": {
    slug: "rukmini",
    image: "https://assets.dataforindia.com/ghost/2024/11/Rukmini2.jpg",
  },
  "Abhishek Waghmare": {
    slug: "abhishek",
    image: "https://assets.dataforindia.com/ghost/2024/03/Abhishek-1-.jpg",
  },
  "Nandlal Mishra": {
    slug: "nandlal",
    image: "https://assets.dataforindia.com/ghost/2024/09/nandlal.jpg",
  },
  "Pramit Bhattacharya": {
    slug: "pramit",
    image: "https://assets.dataforindia.com/ghost/2024/09/pramit.jpg",
  },
  "Nileena Suresh": {
    slug: "nileena",
    image: "https://assets.dataforindia.com/ghost/2024/09/nileena.jpg",
  },
};

export const SEARCH_FIELDS = {
  title: { weight: 20, highlight: true },
  excerpt: { weight: 9, highlight: true },
  headings: { weight: 8, highlight: true },
  plaintext: { weight: 7, highlight: true },
  "tags.name": { weight: 5, highlight: false },
  "tags.slug": { weight: 5, highlight: false },
  authors: { weight: 2, highlight: false },
};

export const SEARCH_PARAMS = {
  highlight_affix_num_tokens: 15,
  num_typos: 2,
  prefix: false,
  per_page: 20,
  drop_tokens_threshold: 0,
  enable_nested_fields: true,
  prioritize_exact_match: true,
  use_cache: true,
  sort_by: "_text_match:desc,updated_at:desc,published_at:desc",
};
