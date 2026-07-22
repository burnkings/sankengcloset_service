// intelligence/personal-score.ts — 个性化评分引擎（第一版）
// 基于用户行为数据计算商品与用户的匹配度
// 不使用 AI，纯规则

import type { PersonalScoreInput, PersonalScoreResult } from '../types.js';

/**
 * 用户偏好画像（从行为数据聚合）
 */
export interface UserPreference {
  followedBrandIds: string[];           // 关注的品牌
  wishlistCategories: string[];         // 收藏的品类
  wishlistTags: string[];               // 收藏的标签
  viewedCategories: string[];           // 浏览的品类
  searchedKeywords: string[];           // 搜索的关键词
}

// ─── 权重配置 ────────────────────────────────────────────────

const WEIGHTS = {
  tag: 0.40,       // 标签匹配
  brand: 0.30,     // 品牌匹配
  category: 0.30,  // 品类匹配
};

// ─── 评分子函数 ────────────────────────────────────────────────

/**
 * 标签匹配评分（0-40）
 * 用户收藏/浏览的标签与商品标签的重合度
 */
function tagMatchScore(
  productTags: string[],
  userTags: string[],
): number {
  if (userTags.length === 0 || productTags.length === 0) return 0;
  const userSet = new Set(userTags.map(t => t.toLowerCase()));
  const matches = productTags.filter(t => userSet.has(t.toLowerCase()));
  // 匹配比例 * 40，最多 40
  const ratio = matches.length / Math.min(productTags.length, 5);
  return Math.round(Math.min(40, ratio * 40));
}

/**
 * 品牌匹配评分（0-30）
 * 用户关注的品牌是否匹配
 */
function brandMatchScore(
  brandId: string,
  followedBrandIds: string[],
): number {
  if (followedBrandIds.length === 0) return 0;
  return followedBrandIds.includes(brandId) ? 30 : 0;
}

/**
 * 品类匹配评分（0-30）
 * 用户偏好品类是否匹配
 */
function categoryMatchScore(
  category: string,
  userCategories: string[],
): number {
  if (userCategories.length === 0) return 0;
  return userCategories.includes(category) ? 30 : 0;
}

// ─── 生成推荐理由 ────────────────────────────────────────────────

function generateMatchReason(params: {
  brandMatch: boolean;
  categoryMatch: boolean;
  tagMatches: string[];
  userCategories: string[];
}): string {
  const { brandMatch, categoryMatch, tagMatches, userCategories } = params;

  if (brandMatch && tagMatches.length > 0) {
    return `你关注的品牌有你喜欢的${tagMatches[0]}元素`;
  }
  if (brandMatch) {
    return '你关注的品牌发布新品';
  }
  if (categoryMatch && tagMatches.length > 0) {
    const catName = userCategories[0] === 'LOLITA' ? 'Lolita'
      : userCategories[0] === 'JK' ? 'JK制服'
      : userCategories[0] === 'HANFU' ? '汉服'
      : userCategories[0];
    return `与你喜欢的${catName}风格匹配`;
  }
  if (tagMatches.length > 0) {
    return `包含你喜欢的${tagMatches[0]}元素`;
  }
  if (categoryMatch) {
    return '与你的偏好品类匹配';
  }
  return '';
}

// ─── 主评分函数 ────────────────────────────────────────────────

/**
 * 计算个性化评分
 */
export function computePersonalScore(
  input: PersonalScoreInput,
  preference: UserPreference,
): PersonalScoreResult {
  // 如果没有用户偏好数据，返回 0
  if (
    preference.followedBrandIds.length === 0 &&
    preference.wishlistCategories.length === 0 &&
    preference.wishlistTags.length === 0 &&
    preference.viewedCategories.length === 0
  ) {
    return {
      personalScore: 0,
      matchReason: '',
      breakdown: { tagMatch: 0, brandMatch: 0, categoryMatch: 0 },
    };
  }

  // 合并用户所有标签来源
  const allUserTags = [
    ...preference.wishlistTags,
    ...preference.viewedCategories, // 品类也作为标签匹配
  ];

  const tagScore = tagMatchScore(input.tags, allUserTags);
  const brandScore = brandMatchScore(input.brandId, preference.followedBrandIds);
  const userCategories = [...new Set([
    ...preference.wishlistCategories,
    ...preference.viewedCategories,
  ])];
  const catScore = categoryMatchScore(input.category, userCategories);

  const personalScore = Math.round(
    tagScore * WEIGHTS.tag / 40 * 100 +
    brandScore * WEIGHTS.brand / 30 * 100 +
    catScore * WEIGHTS.category / 30 * 100,
  );

  const tagMatches = input.tags.filter(t =>
    allUserTags.some(ut => ut.toLowerCase() === t.toLowerCase()),
  );

  const matchReason = generateMatchReason({
    brandMatch: brandScore > 0,
    categoryMatch: catScore > 0,
    tagMatches,
    userCategories,
  });

  return {
    personalScore: Math.min(100, Math.max(0, personalScore)),
    matchReason,
    breakdown: {
      tagMatch: tagScore,
      brandMatch: brandScore,
      categoryMatch: catScore,
    },
  };
}

/**
 * 计算最终排序分
 * final_score = feed_score * 0.7 + personal_score * 0.3
 */
export function computeFinalScore(feedScore: number, personalScore: number): number {
  return Math.round(feedScore * 0.7 + personalScore * 0.3);
}
