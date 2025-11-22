import os
import json
import datetime
from googleapiclient.discovery import build

# --- 設定 ---
API_KEY = os.environ['YOUTUBE_API_KEY']
VIDEO_LIST_PATH = 'data/video_list.json'
HISTORY_PATH = 'stats_history.json'

# 日本時間の定義
JST = datetime.timezone(datetime.timedelta(hours=9))

def get_jst_now():
    return datetime.datetime.now(JST)

def parse_iso_to_jst(iso_str):
    """ISO形式の文字列をJSTのdatetimeオブジェクトに変換"""
    dt = datetime.datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
    return dt.astimezone(JST)

def weighted_predict_current(history_points):
    """
    直近のデータから現在値を予測する
    直近の区間に重みを置いて傾き（再生数/分）を算出
    """
    if len(history_points) < 2:
        return history_points[-1]['views']

    # 最新2点
    p1 = history_points[-1] # 最新
    p2 = history_points[-2] # 1つ前
    
    # 時間差(分)と再生数差
    t1 = parse_iso_to_jst(p1['timestamp'])
    t2 = parse_iso_to_jst(p2['timestamp'])
    delta_min_1 = (t1 - t2).total_seconds() / 60
    if delta_min_1 <= 0: return p1['views']
    
    slope_1 = (p1['views'] - p2['views']) / delta_min_1 # 最新の傾き

    # もう一つ前のデータがあれば、加重平均をとる
    slope_final = slope_1
    if len(history_points) >= 3:
        p3 = history_points[-3]
        t3 = parse_iso_to_jst(p3['timestamp'])
        delta_min_2 = (t2 - t3).total_seconds() / 60
        if delta_min_2 > 0:
            slope_2 = (p2['views'] - p3['views']) / delta_min_2
            # 直近の傾きを70%、その前の傾きを30%としてトレンドを予測
            slope_final = (slope_1 * 0.7) + (slope_2 * 0.3)

    # 現在時刻までの経過分を使って予測
    now = get_jst_now()
    elapsed_min = (now - t1).total_seconds() / 60
    predicted_views = int(p1['views'] + (slope_final * elapsed_min))
    
    return max(predicted_views, p1['views']) # 減らないようにする

def resample_history(raw_history):
    """
    生の履歴データから、毎時00分と30分のデータを補間して作成する
    """
    if not raw_history:
        return []

    # 時系列順にソート
    sorted_points = sorted(raw_history, key=lambda x: parse_iso_to_jst(x['timestamp']))
    
    # データ範囲の特定
    start_dt = parse_iso_to_jst(sorted_points[0]['timestamp'])
    end_dt = parse_iso_to_jst(sorted_points[-1]['timestamp'])
    
    # 開始時刻を直前の00分か30分に丸める
    if start_dt.minute >= 30:
        current_target = start_dt.replace(minute=30, second=0, microsecond=0)
    else:
        current_target = start_dt.replace(minute=0, second=0, microsecond=0)

    resampled_data = []
    
    # 生データのインデックス
    idx = 0
    n = len(sorted_points)

    while current_target <= end_dt:
        # current_target が rawデータのどの区間にあるか探す
        # sorted_points[idx] <= current_target <= sorted_points[idx+1] となる idx を探す
        while idx < n - 1 and parse_iso_to_jst(sorted_points[idx+1]['timestamp']) < current_target:
            idx += 1
            
        if idx < n - 1:
            p_prev = sorted_points[idx]
            p_next = sorted_points[idx+1]
            t_prev = parse_iso_to_jst(p_prev['timestamp'])
            t_next = parse_iso_to_jst(p_next['timestamp'])
            
            if t_next > t_prev:
                # 線形補間 (Linear Interpolation)
                ratio = (current_target - t_prev).total_seconds() / (t_next - t_prev).total_seconds()
                interpolated_views = p_prev['views'] + (p_next['views'] - p_prev['views']) * ratio
                
                resampled_data.append({
                    "timestamp": current_target.isoformat(),
                    "views": int(interpolated_views),
                    "type": "interpolated" # グラフ用フラグ
                })
        
        # 30分進める
        current_target += datetime.timedelta(minutes=30)

    # 最後に「現在（予測値）」を追加
    latest_raw = sorted_points[-1]
    predicted_val = weighted_predict_current(sorted_points)
    
    # 最新の実測時刻より現在時刻が大きく離れている場合のみ追加、または強制的に現在時刻を追加
    resampled_data.append({
        "timestamp": get_jst_now().isoformat(),
        "views": predicted_val,
        "type": "predicted"
    })

    # データ量を制限（例: 直近48時間分 = 48 * 2 = 96点）
    return resampled_data[-100:]

def main():
    # --- 1. マスターデータの読み込み ---
    if not os.path.exists(VIDEO_LIST_PATH):
        print("Error: video_list.json not found.")
        return

    with open(VIDEO_LIST_PATH, 'r', encoding='utf-8') as f:
        video_targets = json.load(f)
    
    video_ids = [v['id'] for v in video_targets]
    
    # --- 2. YouTube APIでデータ取得 ---
    youtube = build('youtube', 'v3', developerKey=API_KEY)
    
    all_fetched_items = []
    chunk_size = 50
    
    for i in range(0, len(video_ids), chunk_size):
        batch_ids = video_ids[i:i + chunk_size]
        try:
            response = youtube.videos().list(
                part='snippet,statistics',
                id=','.join(batch_ids)
            ).execute()
            if 'items' in response:
                all_fetched_items.extend(response['items'])
        except Exception as e:
            print(f"Batch fetch error: {e}")
            continue

    # --- 3. データの更新と加工 ---
    # 既存データのロード
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            full_data = json.load(f)
    else:
        full_data = {}

    current_time_str = get_jst_now().isoformat()

    for item in all_fetched_items:
        vid = item['id']
        stats = item['statistics']
        snippet = item['snippet']
        
        target_info = next((v for v in video_targets if v['id'] == vid), {})
        view_count = int(stats.get('viewCount', 0))
        
        # 初期化
        if vid not in full_data:
            full_data[vid] = {
                "info": {},
                "raw_history": [], # 生データ保存用
                "history": []      # フロントエンド表示用（00分/30分整形済み）
            }

        # 情報更新
        full_data[vid]["info"] = {
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['high']['url'],
            "uploadDate": snippet['publishedAt'],
            "unit": target_info.get('unit', ''),
            "character": target_info.get('character', '')
        }

        # 生データの追加
        full_data[vid]["raw_history"].append({
            "timestamp": current_time_str,
            "views": view_count
        })
        
        # 生データが肥大化しすぎないように古いものを削除（例: 直近300件）
        full_data[vid]["raw_history"] = full_data[vid]["raw_history"][-300:]

        # --- ここで整形処理 (Resampling & Prediction) ---
        # raw_history をもとに、00分/30分のきれいなデータを生成して history に入れる
        full_data[vid]["history"] = resample_history(full_data[vid]["raw_history"])

    # --- 4. 保存 ---
    # 生データ(raw_history)はファイルサイズ削減のためJSONには残さず、
    # 次回実行時に読み込みたいなら別ファイルにするか、ここには含める設計にするか。
    # 今回は「精度向上」のため raw_history も保持しつつ、フロントには history を使わせる構造にします。
    
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(full_data, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    main()
