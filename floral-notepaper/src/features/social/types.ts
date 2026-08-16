export interface UserProfile {
  id: string;
  nickname: string;
  bio: string;
  avatarUrl: string;
  bannerUrl: string;
  website: string;
  location: string;
  createdAt: number;
}

export interface UserStats {
  userId: string;
  articleCount: number;
  followerCount: number;
  followingCount: number;
  likeCount: number;
  viewCount: number;
}

export interface FollowRelation {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: number;
}

export interface ProfileTab {
  key: "articles" | "likes" | "following" | "followers" | "categories";
  label: string;
  count?: number;
}
