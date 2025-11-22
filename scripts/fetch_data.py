import os
import json
import datetime
import math
from googleapiclient.discovery import build

# 設定
API_KEY = os.environ['YOUTUBE_API_KEY']
VIDEO_LIST_PATH = 'data/video_list.json'
HISTORY_PATH = 'stats_history.json'

# 日本時間 (JST) の定義
JST = datetime.timezone(datetime.timedelta(hours=9), 'JST')

def main():
    # マスターデータの読み込み
    with open(VIDEO_LIST_PATH, 'r', encoding='utf-8') as f:
        video_targets = json.load(f)
    
    video_ids = [v['id'] for v in video_targets]
    
    # APIクライアントの準備
    youtube = build('youtube', 'v3', developerKey=API_KEY)
    
    all_items = []
    chunk_size = 50
    
    # 動画データ取得
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

    # 現在時刻 (JST)
    now_jst = datetime.datetime.now(JST)
    now_ts = now_jst.timestamp()
    now_iso = now_jst.isoformat()

    # データの更新・整形
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
                "_raw_history": [], # 計算用の生データ（不定期）
                "history": []       # 表示用の整形データ（00分, 30分, 現在のみ）
            }
            # 旧データからの移行用
            if "history" in history_data[vid] and len(history_data[vid]["history"]) > 0:
                 if not history_data[vid]["_raw_history"]:
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
        history_data[vid]["_raw_history"].append({
            "timestamp": now_iso,
            "ts_val": now_ts, 
            "views": view_count
        })

        # 生データの間引き（計算用に直近500件程度保持）
        if len(history_data[vid]["_raw_history"]) > 500:
             history_data[vid]["_raw_history"] = history_data[vid]["_raw_history"][-500:]

        # 2. 表示用データ(history)の完全再生成
        # 「毎時00分」「毎時30分」と「現在」のみで構成する
        clean_history = generate_clean_history(history_data[vid]["_raw_history"], now_ts)
        history_data[vid]["history"] = clean_history

    # JSON保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

def generate_clean_history(raw_data, current_ts):
    """
    生データから 00分, 30分の固定点 と Current(現在予測値) のみを生成する
    """
    if not raw_data:
        return []

    # 時刻順ソート
    sorted_raw = sorted(raw_data, key=lambda x: x['ts_val'])
    
    # 最初のデータの時刻を取得し、その直後の 00分 or 30分 を開始点とする
    first_ts = sorted_raw[0]['ts_val']
    start_dt = datetime.datetime.fromtimestamp(first_ts, JST)
    
    # 分を0か30に丸め上げる処理
    if start_dt.minute == 0 and start_dt.second == 0:
        # ちょうど00分ならそのまま
        pass
    elif start_dt.minute < 30:
        start_dt = start_dt.replace(minute=30, second=0, microsecond=0)
    else:
        # 次の時間の00分へ
        start_dt = start_dt.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1)

    result_history = []
    
    # ループ用変数
    grid_dt = start_dt
    
    # 現在時刻より手前の 00分/30分 をすべて埋める
    while grid_dt.timestamp() <= current_ts:
        target_ts = grid_dt.timestamp()
        
        # 補間値を取得
        val = get_interpolated_value(target_ts, sorted_raw)
        if val is not None:
            result_history.append({
                "timestamp": grid_dt.isoformat(),
                "views": int(val),
                "type": "fixed" # 固定点
            })
        
        # 30分進める
        grid_dt += datetime.timedelta(minutes=30)

    # 最後に「現在(Current)」の予測値を追加
    # 直近の増加傾向から算出
    predicted_current = get_weighted_prediction(current_ts, sorted_raw)
    
    current_dt_jst = datetime.datetime.fromtimestamp(current_ts, JST)
    result_history.append({
        "timestamp": current_dt_jst.isoformat(),
        "views": int(predicted_current),
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
            
    # 過去データの中に挟まれている場合（線形補間）
    if prev_point and next_point:
        t1, y1 = prev_point['ts_val'], prev_point['views']
        t2, y2 = next_point['ts_val'], next_point['views']
        if t2 == t1: return y1
        return y1 + (y2 - y1) * ((target_ts - t1) / (t2 - t1))
    
    # 範囲外（データ不足）の場合はNoneを返す（グラフにプロットしない）
    return None

def get_weighted_prediction(target_ts, raw_data):
    """
    現在値を予測する。
    最新の実データより時間が進んでいる場合、直近の傾きを使って未来予測する。
    """
    if not raw_data:
        return 0
    
    last_point = raw_data[-1]
    
    # もし生データがターゲット時刻と同じ、あるいは未来ならその値を使う
    if last_point['ts_val'] >= target_ts:
        return last_point['views']

    if len(raw_data) == 1:
        return raw_data[0]['views']

    # 直近3点を使って増加ペース（傾き）を計算
    recent_points = raw_data[-3:] 
    
    weighted_velocity = 0
    total_weight = 0
    
    for i in range(len(recent_points) - 1):
        p1 = recent_points[i]
        p2 = recent_points[i+1]
        
        dt = p2['ts_val'] - p1['ts_val']
        dy = p2['views'] - p1['views']
        
        if dt <= 0: continue
        
        velocity = dy / dt
        weight = (i + 1) * 2 # 直近ほど重く
        
        weighted_velocity += velocity * weight
        total_weight += weight
        
    avg_velocity = weighted_velocity / total_weight if total_weight > 0 else 0

    # 予測計算: 最後の実測値 + (速度 * 経過時間)
    time_diff = target_ts - last_point['ts_val']
    predicted_view = last_point['views'] + (avg_velocity * time_diff)
    
    return int(predicted_view)

if __name__ == '__main__':
    main()
