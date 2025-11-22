import os
import json
import datetime
import time
from googleapiclient.discovery import build

# 設定
API_KEY = os.environ['YOUTUBE_API_KEY']
VIDEO_LIST_PATH = 'data/video_list.json'
HISTORY_PATH = 'stats_history.json'

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

    # 既存データの読み込み
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history_data = json.load(f)
    else:
        history_data = {}

    current_time_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    # データ更新処理
    for item in all_items:
        vid = item['id']
        stats = item['statistics']
        snippet = item['snippet']
        target_info = next((v for v in video_targets if v['id'] == vid), {})
        
        view_count = int(stats.get('viewCount', 0))

        # 初期化
        if vid not in history_data:
            history_data[vid] = {
                "info": {},
                "_raw_history": [], # 生データ保存用（隠しフィールド）
                "history": []       # グラフ表示用（整形済み）
            }
            # 旧データ構造からの移行対応（あれば）
            if "history" in history_data[vid] and len(history_data[vid]["history"]) > 0:
                 history_data[vid]["_raw_history"] = history_data[vid]["history"]

        # 基本情報の更新
        history_data[vid]["info"] = {
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['high']['url'],
            "uploadDate": snippet['publishedAt'],
            "unit": target_info.get('unit', ''),
            "character": target_info.get('character', '')
        }

        # 1. 生データ(_raw_history)に追加
        # タイムスタンプをUnixTime(秒)でも持っておくと計算しやすい
        now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
        
        history_data[vid]["_raw_history"].append({
            "timestamp": current_time_iso,
            "ts_val": now_ts, 
            "views": view_count
        })

        # 生データの間引き（保存容量節約のため直近1週間程度または300件程度を残す）
        # ただし補間のために古すぎるものだけ消す
        if len(history_data[vid]["_raw_history"]) > 500:
             history_data[vid]["_raw_history"] = history_data[vid]["_raw_history"][-500:]

        # 2. 整形データ(history)の再生成
        # 生データをもとに、00分と30分のデータを計算して生成する
        clean_history = generate_clean_history(history_data[vid]["_raw_history"])
        history_data[vid]["history"] = clean_history

    # 保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

def generate_clean_history(raw_data):
    """
    生データから毎時00分、30分、および現在の予測値を生成する
    """
    if not raw_data:
        return []

    # 日付順にソート
    sorted_raw = sorted(raw_data, key=lambda x: x['ts_val'])
    
    # 開始時刻：最初のデータの時刻を30分単位に切り下げ
    first_ts = sorted_raw[0]['ts_val']
    start_dt = datetime.datetime.fromtimestamp(first_ts, datetime.timezone.utc)
    # 分を0か30に丸める
    if start_dt.minute < 30:
        start_dt = start_dt.replace(minute=0, second=0, microsecond=0)
    else:
        start_dt = start_dt.replace(minute=30, second=0, microsecond=0)
        
    result_history = []
    current_dt = start_dt
    now_ts = datetime.datetime.now(datetime.timezone.utc).timestamp()
    
    # 30分刻みでループし、現在時刻の直前まで埋める
    while current_dt.timestamp() <= now_ts:
        target_ts = current_dt.timestamp()
        
        # 予測/補間値を計算
        predicted_views = get_value_at_timestamp(target_ts, sorted_raw)
        
        if predicted_views is not None:
            result_history.append({
                "timestamp": current_dt.isoformat(),
                "views": int(predicted_views),
                "type": "fixed" # 固定点
            })
        
        # 30分進める
        current_dt += datetime.timedelta(minutes=30)

    # 最後に「現在(Current)」の予測値を追加
    # 直近の傾向を加味して予測する
    latest_val = get_weighted_prediction(now_ts, sorted_raw)
    result_history.append({
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "views": int(latest_val),
        "type": "current" # 最新予測
    })

    return result_history

def get_value_at_timestamp(target_ts, raw_data):
    """指定時刻の値を線形補間で求める"""
    # target_tsの前後のデータを探す
    prev_point = None
    next_point = None
    
    for point in raw_data:
        if point['ts_val'] <= target_ts:
            prev_point = point
        else:
            next_point = point
            break
            
    # 過去データの中に挟まれている場合（補間）
    if prev_point and next_point:
        t1, y1 = prev_point['ts_val'], prev_point['views']
        t2, y2 = next_point['ts_val'], next_point['views']
        if t2 == t1: return y1
        # 線形補間計算: y = y1 + (y2-y1) * (t-t1)/(t2-t1)
        return y1 + (y2 - y1) * ((target_ts - t1) / (t2 - t1))
    
    # データがまだない未来、あるいは一番古いデータより前の場合
    # ここでは、最も近い過去データを返すか、Noneを返す
    if prev_point:
        return prev_point['views']
    if next_point:
        return next_point['views']
        
    return None

def get_weighted_prediction(target_ts, raw_data):
    """
    現在または未来の値を予測する。
    直近のデータに重みをつけて増加ペース（傾き）を算出し、それを適用する。
    """
    if not raw_data:
        return 0
    if len(raw_data) == 1:
        return raw_data[0]['views']

    # 直近3点を使って傾向を見る（データが少なければ2点）
    recent_points = raw_data[-3:] 
    
    # 加重平均で「1秒あたりの増加数(velocity)」を計算
    # 直近の区間ほど重みを大きくする
    total_weight = 0
    weighted_velocity = 0
    
    for i in range(len(recent_points) - 1):
        p1 = recent_points[i]
        p2 = recent_points[i+1]
        
        dt = p2['ts_val'] - p1['ts_val']
        dy = p2['views'] - p1['views']
        
        if dt <= 0: continue
        
        velocity = dy / dt
        
        # より新しい区間に高い重み (iが大きくなるほど重くなる)
        weight = (i + 1) * 2 
        
        weighted_velocity += velocity * weight
        total_weight += weight
        
    if total_weight == 0:
        avg_velocity = 0
    else:
        avg_velocity = weighted_velocity / total_weight

    # 最後の実データから経過時間分だけ伸ばす
    last_point = raw_data[-1]
    time_diff = target_ts - last_point['ts_val']
    
    predicted_view = last_point['views'] + (avg_velocity * time_diff)
    return int(predicted_view)

if __name__ == '__main__':
    main()
