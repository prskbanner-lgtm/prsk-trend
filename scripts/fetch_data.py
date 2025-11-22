import os
import json
import datetime
from googleapiclient.discovery import build

# --- 設定: 日本時間 (JST) の定義 ---
JST = datetime.timezone(datetime.timedelta(hours=9), 'JST')

# 環境変数とパス
API_KEY = os.environ['YOUTUBE_API_KEY']
VIDEO_LIST_PATH = 'data/video_list.json'
HISTORY_PATH = 'stats_history.json'

def main():
    # 1. マスターデータの読み込み
    with open(VIDEO_LIST_PATH, 'r', encoding='utf-8') as f:
        video_targets = json.load(f)
    
    video_ids = [v['id'] for v in video_targets]
    
    # 2. YouTube APIで現時点のデータを取得
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

    # 3. 既存データの読み込み
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history_data = json.load(f)
    else:
        history_data = {}

    # 現在時刻 (JST)
    now_jst = datetime.datetime.now(JST)
    current_time_iso = now_jst.isoformat()
    now_ts = now_jst.timestamp()

    # 4. データ更新処理
    for item in all_items:
        vid = item['id']
        stats = item['statistics']
        snippet = item['snippet']
        target_info = next((v for v in video_targets if v['id'] == vid), {})
        
        view_count = int(stats.get('viewCount', 0))

        # データ構造の初期化
        if vid not in history_data:
            history_data[vid] = {
                "info": {},
                "_raw_history": [], # 生データ（不規則な時間を含む）
                "history": []       # 表示用データ（00/30/Currentのみ）
            }
            # 旧データからの移行（もしあれば）
            if "history" in history_data[vid] and len(history_data[vid]["history"]) > 0:
                # _raw_historyが空の場合のみ、既存historyをrawとして扱う
                if not history_data[vid].get("_raw_history"):
                    history_data[vid]["_raw_history"] = history_data[vid]["history"]

        # 動画情報の更新
        history_data[vid]["info"] = {
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['high']['url'],
            "uploadDate": snippet['publishedAt'],
            "unit": target_info.get('unit', ''),
            "character": target_info.get('character', '')
        }

        # (A) 生データ(_raw_history)に追加
        # ここにはAPIを叩いた正確な時間を保存する
        history_data[vid]["_raw_history"].append({
            "timestamp": current_time_iso,
            "ts_val": now_ts, 
            "views": view_count
        })

        # 生データの肥大化防止（直近500件程度保持）
        if len(history_data[vid]["_raw_history"]) > 500:
             history_data[vid]["_raw_history"] = history_data[vid]["_raw_history"][-500:]

        # (B) 表示用データ(history)の完全再生成
        # 既存のhistoryを捨てて、rawデータから綺麗なグラフ用データを計算し直す
        clean_history = generate_clean_history(history_data[vid]["_raw_history"], now_jst)
        history_data[vid]["history"] = clean_history

    # 5. 保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

def generate_clean_history(raw_data, now_jst):
    """
    生データから毎時00分、30分、および現在の予測値を生成する。
    raw_dataに含まれる不規則な時間は一切出力しない。
    """
    if not raw_data:
        return []

    # 日付順にソート
    sorted_raw = sorted(raw_data, key=lambda x: x['ts_val'])
    
    # データの開始点（最初のデータの時刻）
    first_ts = sorted_raw[0]['ts_val']
    
    # 生成を開始する基準時刻：最初のデータ直後の00分か30分
    start_dt = datetime.datetime.fromtimestamp(first_ts, JST)
    if start_dt.minute < 30:
        start_dt = start_dt.replace(minute=30, second=0, microsecond=0)
    else:
        # 次の時間の00分へ
        start_dt = (start_dt + datetime.timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)

    # もし生データが少なすぎて基準時刻が未来になってしまう場合は、最初の生データの時刻を基準に調整
    # (ただしグラフの見た目を整えるため、基本は30分刻みループに入る)
    
    result_history = []
    current_dt = start_dt
    now_ts = now_jst.timestamp()
    
    # --- ループ: 00分と30分のデータを作成 ---
    # 現在時刻の手前までループ
    while current_dt.timestamp() <= now_ts:
        target_ts = current_dt.timestamp()
        
        # まだデータが存在しない過去の予測はしない（最初の生データより前はスキップ）
        if target_ts < first_ts:
            current_dt += datetime.timedelta(minutes=30)
            continue

        # 線形補間で値を算出
        predicted_views = get_interpolated_value(target_ts, sorted_raw)
        
        if predicted_views is not None:
            result_history.append({
                "timestamp": current_dt.isoformat(), # JST
                "views": int(predicted_views),
                "type": "fixed"
            })
        
        current_dt += datetime.timedelta(minutes=30)

    # --- 最後: 現在時刻(Current)の予測値を追加 ---
    # これが唯一、00/30分以外のデータとなる
    latest_prediction = get_weighted_prediction(now_ts, sorted_raw)
    
    result_history.append({
        "timestamp": now_jst.isoformat(),
        "views": int(latest_prediction),
        "type": "current"
    })

    return result_history

def get_interpolated_value(target_ts, raw_data):
    """指定時刻の値を線形補間で求める"""
    prev_point = None
    next_point = None
    
    for point in raw_data:
        if point['ts_val'] <= target_ts:
            prev_point = point
        else:
            next_point = point
            break
            
    if prev_point and next_point:
        t1, y1 = prev_point['ts_val'], prev_point['views']
        t2, y2 = next_point['ts_val'], next_point['views']
        if t2 == t1: return y1
        return y1 + (y2 - y1) * ((target_ts - t1) / (t2 - t1))
    
    # 端点の処理
    if prev_point: return prev_point['views']
    if next_point: return next_point['views']
    return None

def get_weighted_prediction(target_ts, raw_data):
    """直近の増加傾向を加味して現在値を予測"""
    if not raw_data: return 0
    if len(raw_data) == 1: return raw_data[0]['views']

    # 直近のデータ数点を使って傾きを計算
    recent_points = raw_data[-3:] 
    total_weight = 0
    weighted_velocity = 0
    
    for i in range(len(recent_points) - 1):
        p1 = recent_points[i]
        p2 = recent_points[i+1]
        dt = p2['ts_val'] - p1['ts_val']
        dy = p2['views'] - p1['views']
        if dt <= 0: continue
        
        velocity = dy / dt
        weight = (i + 1) * 2 
        weighted_velocity += velocity * weight
        total_weight += weight
        
    avg_velocity = weighted_velocity / total_weight if total_weight > 0 else 0
    last_point = raw_data[-1]
    time_diff = target_ts - last_point['ts_val']
    
    predicted_view = last_point['views'] + (avg_velocity * time_diff)
    return int(predicted_view)

if __name__ == '__main__':
    main()
