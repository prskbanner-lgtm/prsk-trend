import os
import json
import datetime
import math
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
    
    # IDが多い場合を考慮して分割取得
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

    # 3. 既存の履歴データを読み込み
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history_data = json.load(f)
    else:
        history_data = {}

    # 現在時刻 (JST)
    now_jst = datetime.datetime.now(JST)
    current_time_iso = now_jst.isoformat()
    now_ts = now_jst.timestamp()

    # 4. データ更新と整形処理
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
                "_raw_history": [], # 生データ（計算用・不定期）
                "history": []       # 表示用（00分/30分/現在）
            }
            # 旧データ構造からの移行用
            if "history" in history_data[vid] and len(history_data[vid]["history"]) > 0:
                 # 古いデータがあればrawに退避（形式が合う場合のみ）
                 if "_raw_history" not in history_data[vid] or not history_data[vid]["_raw_history"]:
                     history_data[vid]["_raw_history"] = history_data[vid]["history"]

        # 動画情報の更新
        history_data[vid]["info"] = {
            "title": snippet['title'],
            "thumbnail": snippet['thumbnails']['high']['url'],
            "uploadDate": snippet['publishedAt'], # これはUTCのままでOK（JSで変換）
            "unit": target_info.get('unit', ''),
            "character": target_info.get('character', '')
        }

        # (A) 生データ(_raw_history)に追加
        history_data[vid]["_raw_history"].append({
            "timestamp": current_time_iso,
            "ts_val": now_ts, 
            "views": view_count
        })

        # 生データの肥大化防止（直近500件保持）
        if len(history_data[vid]["_raw_history"]) > 500:
             history_data[vid]["_raw_history"] = history_data[vid]["_raw_history"][-500:]

        # (B) 表示用データ(history)の生成
        # ここで「00分」「30分」「現在」のみを生成する
        clean_history = generate_clean_history(history_data[vid]["_raw_history"], now_jst)
        history_data[vid]["history"] = clean_history

    # 5. 保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

def generate_clean_history(raw_data, now_jst):
    """
    生データから毎時00分、30分、および現在の予測値を生成する
    全てJST基準で処理する
    """
    if not raw_data:
        return []

    # 日付順にソート
    sorted_raw = sorted(raw_data, key=lambda x: x['ts_val'])
    
    # 最初のデータの時刻を取得し、JSTの直近の00分か30分に丸める
    first_ts = sorted_raw[0]['ts_val']
    start_dt = datetime.datetime.fromtimestamp(first_ts, JST)
    
    if start_dt.minute < 30:
        start_dt = start_dt.replace(minute=0, second=0, microsecond=0)
    else:
        start_dt = start_dt.replace(minute=30, second=0, microsecond=0)
        
    result_history = []
    current_dt = start_dt
    now_ts = now_jst.timestamp()
    
    # ループ：開始時刻から現在時刻の手前まで、30分刻みでポイントを作成
    while current_dt.timestamp() <= now_ts:
        target_ts = current_dt.timestamp()
        
        # その時刻の値を線形補間で算出
        predicted_views = get_interpolated_value(target_ts, sorted_raw)
        
        if predicted_views is not None:
            result_history.append({
                "timestamp": current_dt.isoformat(), # JSTのISO文字列
                "views": int(predicted_views),
                "type": "fixed" # 固定点(00 or 30)
            })
        
        # 30分進める
        current_dt += datetime.timedelta(minutes=30)

    # 最後に「現在(Current)」の予測値を追加
    # 直近のトレンド（傾き）を考慮して予測
    latest_prediction = get_weighted_prediction(now_ts, sorted_raw)
    
    # 直前の30分データと重複しないように、数分以上離れている場合のみ追加するか、
    # または常に「現在」として追加してグラフ上で表示するか。
    # ここでは常に「現在の予測値」として末尾に追加する仕様にする。
    result_history.append({
        "timestamp": now_jst.isoformat(),
        "views": int(latest_prediction),
        "type": "current" # 最新予測
    })

    return result_history

def get_interpolated_value(target_ts, raw_data):
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
        # 線形補間: y = y1 + (y2-y1) * (t-t1)/(t2-t1)
        return y1 + (y2 - y1) * ((target_ts - t1) / (t2 - t1))
    
    # データ外の場合（最も近い値を採用）
    if prev_point: return prev_point['views']
    if next_point: return next_point['views']
    return None

def get_weighted_prediction(target_ts, raw_data):
    """
    現在値を予測する。
    直近のデータに重みをつけて増加ペース（傾き）を算出し、それを適用する。
    """
    if not raw_data: return 0
    if len(raw_data) == 1: return raw_data[0]['views']

    # 直近3点を使って傾向を見る
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
        
        # より新しい区間に高い重み
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
