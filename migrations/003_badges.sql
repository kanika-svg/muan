-- badges table already has code/name/name_lo/rule (see schema.sql);
-- icon is new, add it before seeding.
ALTER TABLE badges ADD COLUMN icon TEXT;

INSERT OR IGNORE INTO badges (code, name, name_lo, rule, icon) VALUES
 ('explorer',   'Explorer',   'ນັກສຳຫຼວດ',  'Checked in at 10 different places', '🧭'),
 ('regular',    'Regular',    'ຂາປະຈຳ',     'Checked in 5 times at one place',   '🪑'),
 ('night-owl',  'Night Owl',  'ນົກເຄົ້າ',    'Checked in after midnight',         '🌙'),
 ('riverside',  'Riverside',  'ແຄມຂອງ',     'Checked in at 3 riverside places',  '🌊'),
 ('first-fire', 'First Fire', 'ໄຟດວງທຳອິດ', 'Your very first check-in',          '🔥');
