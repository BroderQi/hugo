document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('[data-search]');
  if (!panel) {
    return;
  }

  const input = panel.querySelector('#search-input');
  const results = panel.querySelector('#search-results');
  const defaultCards = document.querySelectorAll('.cards');
  if (!input || !results || defaultCards.length === 0) {
    return;
  }

  const primaryCards = defaultCards[defaultCards.length - 1];
  let items = [];

  function render(itemsToRender) {
    results.innerHTML = '';
    if (!itemsToRender.length) {
      results.innerHTML = '<div class="empty-state">没有找到匹配的文章，请换个关键词试试。</div>';
      return;
    }

    for (const item of itemsToRender) {
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <p class="meta">${item.date || ''}</p>
        <h2><a href="${item.permalink}">${item.title}</a></h2>
        <p>${item.description || ''}</p>
      `;
      results.appendChild(card);
    }
  }

  function toggleSearchView(query) {
    const active = query.trim().length > 0;
    primaryCards.hidden = active;
    results.hidden = !active;
  }

  function filter() {
    const q = input.value.trim().toLowerCase();
    toggleSearchView(q);
    if (!q) {
      return;
    }

    const filtered = items.filter((item) => {
      return [item.title, item.description].some((value) => {
        return (value || '').toLowerCase().includes(q);
      });
    });
    render(filtered);
  }

  fetch('/search-index.json')
    .then((res) => res.json())
    .then((data) => {
      items = Array.isArray(data) ? data : [];
      input.addEventListener('input', filter);
    })
    .catch(() => {
      input.disabled = true;
      input.placeholder = '搜索暂时不可用';
    });
});
