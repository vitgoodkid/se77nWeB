// Project K release page. The download link and the build's facts live here: paste the Google Drive link into url.
const RELEASE = {
  url: 'https://drive.google.com/file/d/1HcCAI8t3QWq5Iw3zy5P9QoPHxgGx3nhO/view?usp=sharing', // Google Drive link of the zipped build
  version: '13/10/2026',
  size: '≈ 850 MB',
  platform: 'Windows 64-bit',
};

// The pictures (release/*.jpg), taken in the game.
const SHOTS = [
  { src: 'release/01_river_dawn.jpg', cap: 'Bờ sông nơi Kata tỉnh dậy, lúc rạng sáng. Phía xa là Aelvar, the Everroot.' },
  { src: 'release/02_village_golden.jpg', cap: 'Đi vào làng Willowmere lúc hoàng hôn.' },
  { src: 'release/09_portrait.jpg', cap: 'Kata trong giáp Samurai, katana trên tay.' },
  { src: 'release/06_storm_sigil.jpg', cap: 'Storm Sigil giáng sét xuống một bầy xương.' },
  { src: 'release/05_ice_nova.jpg', cap: 'Ice Nova: gai băng bung ra quanh người.' },
  { src: 'release/05_meteor.jpg', cap: 'Meteor Strike rơi giữa bầy quái.' },
  { src: 'release/03_ashfang.jpg', cap: 'Đại trại goblin Ashfang lúc chiều tà.' },
  { src: 'release/04_gruk.jpg', cap: 'Gruk, the Ashfang King.' },
  { src: 'release/08_rift.jpg', cap: 'Rift rừng đá: một thế giới đã bị cây hút cạn.' },
  { src: 'release/07_inventory.jpg', cap: 'Nhân vật và túi đồ kiểu Path of Exile 2.' },
];

(function () {
  const has = !!RELEASE.url;
  document.querySelectorAll('[data-version]').forEach(e => e.textContent = RELEASE.version);
  document.querySelectorAll('[data-size]').forEach(e => e.textContent = RELEASE.size);
  const main = document.querySelector('[data-dl-main]');
  const meta = document.querySelector('[data-dl-meta]');
  const note = document.querySelector('[data-dl-note]');
  meta.textContent = `${RELEASE.platform} · ${RELEASE.size} sau giải nén`;
  if (has) {
    main.href = RELEASE.url;
    main.target = '_blank';
    main.rel = 'noopener';
    note.textContent = 'Mở Google Drive · tải file .7z, giải nén rồi chạy Whosnext.exe';
  } else {
    main.classList.add('off');
    main.removeAttribute('href');
    document.querySelector('[data-dl-label]').textContent = 'Link tải sắp có';
    note.textContent = 'Bản build đang được tải lên.';
  }
  const bar = document.querySelector('[data-dl]');
  if (has) { bar.href = RELEASE.url; bar.target = '_blank'; bar.rel = 'noopener'; }

  // Gallery: the first picture large, the rest in a grid.
  const grid = document.getElementById('grid');
  SHOTS.forEach((s, i) => {
    const f = document.createElement('figure');
    if (i === 0) f.className = 'wide';
    const img = new Image();
    img.src = s.src; img.alt = s.cap; img.loading = i < 3 ? 'eager' : 'lazy'; img.decoding = 'async';
    img.onerror = () => f.remove();
    f.append(img);
    const c = document.createElement('figcaption'); c.textContent = s.cap; f.append(c);
    f.addEventListener('click', () => open(s));
    grid.append(f);
  });

  const box = document.getElementById('lightbox');
  const bimg = box.querySelector('img'), bcap = box.querySelector('p');
  function open(s) { bimg.src = s.src; bimg.alt = s.cap; bcap.textContent = s.cap; box.hidden = false; document.body.style.overflow = 'hidden'; }
  function close() { box.hidden = true; document.body.style.overflow = ''; }
  box.addEventListener('click', e => { if (e.target !== bimg) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) close(); });

  // The bar darkens once past the top.
  const header = document.querySelector('.bar');
  const onScroll = () => header.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
})();
