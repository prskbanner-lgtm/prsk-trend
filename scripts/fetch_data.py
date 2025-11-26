import os
import json
import datetime
from googleapiclient.discovery import build

# 設定
API_KEY = os.environ['YOUTUBE_API_KEY']
VIDEO_LIST_PATH = 'data/video_list.json'
HISTORY_PATH = 'stats_history.json'

# JSTタイムゾーンの定義
JST = datetime.timezone(datetime.timedelta(hours=9))

def get_jst_midnight_timestamp(date_obj):
    """指定された日時オブジェクトから、その日のJST 00:00:00 のタイムスタンプを取得"""
    # タイムゾーン情報を保持しつつ日付のみ抽出して00:00にする
    return date_obj.replace(hour=0, minute=0, second=0, microsecond=0)

def interpolate_value(target_time_ts, p1, p2):
    """2点間の線形補間"""
    t1 = datetime.datetime.fromisoformat(p1['timestamp']).timestamp()
    t2 = datetime.datetime.fromisoformat(p2['timestamp']).timestamp()
    v1 = p1['views']
    v2 = p2['views']
    
    if t2 == t1: return v1
    
    ratio = (target_time_ts - t1) / (t2 - t1)
    return int(v1 + (v2 - v1) * ratio)

def archive_daily_stats(video_data):
    """
    recent_historyからJST 00:00の予測値を計算し、daily_historyにアーカイブする。
    すでにその日のアーカイブが存在する場合はスキップする。
    """
    recent = video_data.get('recent_history', [])
    daily = video_data.get('daily_history', [])
    
    if not recent:
        return daily

    # existing_dates: すでにアーカイブ済みの「日」の集合 (ISO形式の日付部分)
    existing_dates = set()
    for d in daily:
        dt = datetime.datetime.fromisoformat(d['timestamp'])
        existing_dates.add(dt.date().isoformat())

    # recentデータを時間順にソート
    sorted_recent = sorted(recent, key=lambda x: datetime.datetime.fromisoformat(x['timestamp']).timestamp())
    
    if not sorted_recent:
        return daily

    # 範囲内のすべての日付(00:00)についてチェック
    first_dt = datetime.datetime.fromisoformat(sorted_recent[0]['timestamp']).astimezone(JST)
    last_dt = datetime.datetime.fromisoformat(sorted_recent[-1]['timestamp']).astimezone(JST)
    
    # ループ用変数（最初の日付の翌日の00:00から開始）
    current_check_date = first_dt.replace(hour=0, minute=0, second=0, microsecond=0) + datetime.timedelta(days=1)

    while current_check_date <= last_dt:
        date_str = current_check_date.date().isoformat()
        
        # まだアーカイブされていない場合のみ計算
        if date_str not in existing_dates:
            target_ts = current_check_date.timestamp()
            
            # ターゲット時刻を挟む2点を探す
            prev_point = None
            next_point = None
            
            for point in sorted_recent:
                pt_ts = datetime.datetime.fromisoformat(point['timestamp']).timestamp()
                if pt_ts <= target_ts:
                    prev_point = point
                else:
                    next_point = point
                    break # 次の点が見つかったら終了
            
            if prev_point and next_point:
                # 補間計算
                val = interpolate_value(target_ts, prev_point, next_point)
                daily.append({
                    "timestamp": current_check_date.isoformat(),
                    "views": val
                })
                existing_dates.add(date_str)
        
        current_check_date += datetime.timedelta(days=1)
        
    # 日付順にソートして返す
    return sorted(daily, key=lambda x: x['timestamp'])

def prune_old_recent_history(recent_history):
    """
    30日以上前のデータをrecent_historyから削除する
    """
    now = datetime.datetime.now(JST)
    threshold = now - datetime.timedelta(days=30)
    
    new_recent = []
    for h in recent_history:
        dt = datetime.datetime.fromisoformat(h['timestamp'])
        if dt > threshold:
            new_recent.append(h)
            
    return new_recent

def main():
    # マスターデータの読み込み
    with open(VIDEO_LIST_PATH, 'r', encoding='utf-8') as f:
        video_targets = json.load(f)
    
    video_ids = [v['id'] for v in video_targets]
    
    # APIクライアントの準備
    youtube = build('youtube', 'v3', developerKey=API_KEY)
    
    all_items = []
    chunk_size = 50
    
    for i in range(0, len(video_ids), chunk_size):
        batch_ids = video_ids[i:i + chunk_size]
        try:
            response = youtube.videos().list(
                part='snippet,statistics',
                id=','.join(batch_ids)
            ).execute()
            
            if 'items' in response:
                all_items.extend(response['items'])
                
        except Exception as e:
            print(f"Error fetching batch {i}: {e}")
            continue

    # 既存の履歴データを読み込み
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history_data = json.load(f)
    else:
        history_data = {}

    # 現在時刻をJSTで取得してISOフォーマット化
    current_time_jst = datetime.datetime.now(JST).isoformat()

    # データの更新
    for item in all_items:
        vid = item['id']
        stats = item['statistics']
        snippet = item['snippet']
        
        target_info = next((v for v in video_targets if v['id'] == vid), {})
        view_count = int(stats.get('viewCount', 0))
        
        # 新規データ構造への初期化・移行
        if vid not in history_data:
            history_data[vid] = {
                "info": {},
                "recent_history": [],
                "daily_history": []
            }
        
        # 旧フォーマット(history)が存在する場合の移行処理
        if "history" in history_data[vid]:
            if not history_data[vid].get("recent_history"):
                history_data[vid]["recent_history"] = history_data[vid]["history"]
            del history_data[vid]["history"]
        
        # daily_historyキーがない場合の初期化
        if "daily_history" not in history_data[vid]:
            history_data[vid]["daily_history"] = []

        # タイトル等更新
        history_data[vid]["info"] = {
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['high']['url'],
            "uploadDate": snippet['publishedAt'],
            "unit": target_info.get('unit', ''),
            "character": target_info.get('character', ''),
            "type": target_info.get('type', '未分類'),    # NEW: 書き下ろしかカバーか
            "genre": target_info.get('genre', '未分類')  # NEW: ジャンル
        }

        # recent_historyに現在データを追加
        history_data[vid]["recent_history"].append({
            "timestamp": current_time_jst,
            "views": view_count
        })

        # --- 容量削減処理 ---
        # 1. 00:00 JSTのデータを計算してアーカイブ (daily_historyへ)
        history_data[vid]["daily_history"] = archive_daily_stats(history_data[vid])
        
        # 2. 古い詳細データを削除 (直近30日分のみ保持)
        history_data[vid]["recent_history"] = prune_old_recent_history(history_data[vid]["recent_history"])

    # 保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    main()

