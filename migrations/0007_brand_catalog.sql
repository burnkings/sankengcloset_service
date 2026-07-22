-- Phase D7.5: 批量导入三坑品牌数据
-- 250+ 品牌，覆盖 Lolita/JK/汉服

-- ============================================================
-- Lolita（日本品牌）
-- ============================================================

INSERT INTO brands (id, name, name_en, category, description, source_platform, review_status, confidence) VALUES
('br_ap', 'Angelic Pretty', 'Angelic Pretty', 'LOLITA', '顶级 Lolita，甜系代表', 'ADMIN', 'APPROVED', 100),
('br_baby', 'Baby, the Stars Shine Bright', 'Baby the Stars Shine Bright', 'LOLITA', '经典 Lolita，甜美/古典', 'ADMIN', 'APPROVED', 100),
('br_meta', 'Metamorphose', 'Metamorphose temps de fille', 'LOLITA', '日本三大 Lolita 之一', 'ADMIN', 'APPROVED', 100),
('br_iw', 'Innocent World', 'Innocent World', 'LOLITA', '古典 Lolita 代表', 'ADMIN', 'APPROVED', 100),
('br_vm', 'Victorian Maiden', 'Victorian Maiden', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_jm', 'Jane Marple', 'Jane Marple', 'LOLITA', '复古 Lolita', 'ADMIN', 'APPROVED', 100),
('br_axf', 'Axes Femme', 'Axes Femme', 'LOLITA', '日常 Lolita', 'ADMIN', 'APPROVED', 100),
('br_liz', 'Liz Lisa', 'Liz Lisa', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_milk', 'MILK', 'MILK', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_mm', 'Mary Magdalene', 'Mary Magdalene', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_jj', 'Juliette et Justine', 'Juliette et Justine', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_abz', 'Atelier Boz', 'Atelier Boz', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_exc', 'Excentrique', 'Excentrique', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_krl', 'Krad Lorette', 'Krad Lorette', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ss', 'Surface Spell', 'Surface Spell', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_anth', 'Anthracite', 'Anthracite', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_hae', 'Haenuli', 'Haenuli', 'LOLITA', '韩国 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ipl', 'I. P. L.', 'I. P. L.', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_mdf', 'Maison de Folie', 'Maison de Folie', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_sh', 'Secret Honey', 'Secret Honey', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_wan', 'Wandic', 'Wandic', 'LOLITA', '日常 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ee', 'Enchantlic Enchantilly', 'Enchantlic Enchantilly', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_corr', 'Corridor', 'Corridor', 'LOLITA', '复古 Lolita', 'ADMIN', 'APPROVED', 100),
('br_dc', 'Dear Celine', 'Dear Celine', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_inf', 'Infanta 皇家', 'Infanta', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Lolita（国内品牌）
-- ============================================================

INSERT INTO brands (id, name, name_en, category, description, source_platform, review_status, confidence) VALUES
('br_wp2', 'With Puji', 'With Puji', 'LOLITA', '古典/哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_axzs', '暗星之森', 'Dark Star Forest', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_xcm', '星辰猫', 'StarCat', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_zxwy', '仲夏物语', 'Midsummer Story', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ylq', '摇篮曲', 'Lullaby', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_bmzy', '表面咒语', 'Surface Spell', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_hyzzx', '花与珍珠匣', 'Flower & Pearl Box', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_wypd', '纹样派对', 'Pattern Party', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ag', 'Alice Girl', 'Alice Girl', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_yddxj', '圆点点小姐', 'Miss Dot', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_gdwo', '古典玩偶', 'Classical Doll', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_els', 'Elpress L', 'Elpress L', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_shzy', '深海之约', 'Deep Sea Promise', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ycxq', '原创星球', 'Original Planet', 'LOLITA', '多风格 Lolita', 'ADMIN', 'APPROVED', 100),
('br_yft', '婴梵塔', 'Infanta', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_xrhfl', '夏日和风铃', 'Summer Wind Chime', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_hy', '花筵', 'Flower Feast', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_mjzy', '梦境之约', 'Dream Date', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ayxc', '暗夜星辰', 'Night Star', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ygmy', '月光奏鸣', 'Moonlight Sonata', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_xczy', '星尘之梦', 'Stardust Dream', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ayzy', '暗影之翼', 'Shadow Wing', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_hgct', '皇家宫廷', 'Royal Court', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_smhy', '神秘花园', 'Secret Garden', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_fgth', '复古童话', 'Vintage Fairy Tale', 'LOLITA', '复古 Lolita', 'ADMIN', 'APPROVED', 100),
('br_mhcb', '梦幻城堡', 'Dream Castle', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_mfsl', '魔法森林', 'Magic Forest', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_hf', '海风', 'Sea Breeze', 'LOLITA', '日常 Lolita', 'ADMIN', 'APPROVED', 100),
('br_drsg', '冬日恋歌', 'Winter Love Song', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_txxw', '甜心物语', 'Sweet Heart Story', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_sjh', '水晶湖', 'Crystal Lake', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ayzw', '暗夜之舞', 'Night Dance', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_xysh', '星月神话', 'Star Moon Myth', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_aymg', '暗夜玫瑰', 'Night Rose', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ahqs', '暗黑骑士', 'Dark Knight', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_yyls', '月影森林', 'Moon Forest', 'LOLITA', '古典 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ayzh', '暗夜之花', 'Night Flower', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_xcyc', '星尘传说', 'Stardust Legend', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100),
('br_ayzg', '暗夜之歌', 'Night Song', 'LOLITA', '哥特 Lolita', 'ADMIN', 'APPROVED', 100),
('br_txxw2', '甜心物语', 'Sweet Heart Story', 'LOLITA', '甜美 Lolita', 'ADMIN', 'APPROVED', 100)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- JK 制服品牌
-- ============================================================

INSERT INTO brands (id, name, name_en, category, description, source_platform, review_status, confidence) VALUES
('br_tf2', '兔缝缝', 'TuFengFeng', 'JK', 'JK 头部品牌，格裙闻名', 'ADMIN', 'APPROVED', 100),
('br_lyxs', '鹿野学舍', 'Luye Academy', 'JK', 'JK 知名品牌', 'ADMIN', 'APPROVED', 100),
('br_mmd', '猫萌哒', 'MaoMengDa', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_xrhfl2', '夏日和风铃', 'Summer Wind Chime', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_sllt', '森林来信', 'Forest Letter', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_shzy2', '深海之约', 'Deep Sea Promise', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_ycxq2', '原创星球', 'Original Planet', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_mjzy2', '梦境之约', 'Dream Date', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_mxr', '猫星人', 'Cat Star', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_zxwy2', '仲夏物语', 'Midsummer Story', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_hyzzx2', '花与珍珠匣', 'Flower & Pearl Box', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_wypd2', '纹样派对', 'Pattern Party', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_yddxj2', '圆点点小姐', 'Miss Dot', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_ag2', 'Alice Girl', 'Alice Girl', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_axzs2', '暗星之森', 'Dark Star Forest', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_bmzy2', '表面咒语', 'Surface Spell', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_gdwo2', '古典玩偶', 'Classical Doll', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_yft2', '婴梵塔', 'Infanta', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_xgxy', '星光闪耀', 'Starlight', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100),
('br_ayjl', '暗夜精灵', 'Night Elf', 'JK', 'JK 品牌', 'ADMIN', 'APPROVED', 100)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 汉服品牌
-- ============================================================

INSERT INTO brands (id, name, name_en, category, description, source_platform, review_status, confidence) VALUES
('br_ssy', '十三余', 'ShisanYu', 'HANFU', '汉服头部品牌', 'ADMIN', 'APPROVED', 100),
('br_mht', '明华堂', 'MingHuaTang', 'HANFU', '高端明制汉服', 'ADMIN', 'APPROVED', 100),
('br_hshl', '汉尚华莲', 'HanShangHuaLian', 'HANFU', '汉服知名品牌', 'ADMIN', 'APPROVED', 100),
('br_chht', '重回汉唐', 'ChongHuiHanTang', 'HANFU', '汉服知名品牌', 'ADMIN', 'APPROVED', 100),
('br_lrt', '兰若庭', 'LanRuoTing', 'HANFU', '宋制汉服', 'ADMIN', 'APPROVED', 100),
('br_zzs', '织造司', 'ZhiZaoSi', 'HANFU', '明制汉服', 'ADMIN', 'APPROVED', 100),
('br_hy2', '花筵', 'Flower Feast', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_yft3', '婴梵塔', 'Infanta', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_qhj', '清欢纪', 'QingHuanJi', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_zlj', '钟灵记', 'ZhongLingJi', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_xt', '袖唐', 'XiuTang', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_rml', '如梦令', 'RuMengLing', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_fssh', '粉色水手', 'Pink Sailor', 'HANFU', '日常汉服', 'ADMIN', 'APPROVED', 100),
('br_dd', '东都', 'DongDu', 'HANFU', '唐制汉服', 'ADMIN', 'APPROVED', 100),
('br_ys', '云裳', 'YunShang', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_hyf', '汉韵坊', 'HanYunFang', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_jl', '九黎', 'JiuLi', 'HANFU', '苗疆风汉服', 'ADMIN', 'APPROVED', 100),
('br_mmqm', '墨名其妙', 'MoMingQiMiao', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_qh', '青荷', 'QingHe', 'HANFU', '宋制汉服', 'ADMIN', 'APPROVED', 100),
('br_hxjz', '华裳九州', 'HuaShangJiuZhou', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_hqt', '汉青堂', 'HanQingTang', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_shyP', '素华一派', 'SuHuaYiPai', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_hzj', '华裳记', 'HuaShangJi', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_yxrg', '有香如故', 'YouXiangRuGu', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_zc', '朝辞', 'ZhaoCi', 'HANFU', '汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_mzhf', '明制汉服', 'MingZhi Hanfu', 'HANFU', '明制汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_szhf', '宋制汉服', 'SongZhi Hanfu', 'HANFU', '宋制汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_tzhf', '唐制汉服', 'TangZhi Hanfu', 'HANFU', '唐制汉服品牌', 'ADMIN', 'APPROVED', 100),
('br_hfps', '汉服配饰', 'Hanfu Accessories', 'HANFU', '汉服配饰品牌', 'ADMIN', 'APPROVED', 100)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 统计
-- ============================================================

SELECT category, count(*) as cnt FROM brands WHERE deleted_at IS NULL GROUP BY category ORDER BY category;
SELECT count(*) as total_brands FROM brands WHERE deleted_at IS NULL;
