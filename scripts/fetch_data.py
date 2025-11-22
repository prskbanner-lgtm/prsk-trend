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

def clean_history_data(history):
    """
    履歴データを整理する関数
    - 直近35日以内のデータ: すべて保持
    - 35日より前のデータ: 1日につき最初の1件(日付が変わった直後のデータ)のみ保持
    """
    if not history:
        return []

    # 時刻順にソート
    history.sort(key=lambda x: x['timestamp'])

    now_jst = datetime.datetime.now(JST)
    cutoff_date = now_jst - datetime.timedelta(days=35)

    cleaned = []
    seen_dates = set()

    for entry in history:
        # タイムスタンプ文字列をdatetimeオブジェクトに変換
        try:
            entry_dt = datetime.datetime.fromisoformat(entry['timestamp'])
        except ValueError:
            continue

        if entry_dt > cutoff_date:
            # 直近のデータはすべて保持
            cleaned.append(entry)
        else:
            # 古いデータは1日1件（その日の最初のデータ）のみ保持
            # JSTでの日付文字列を取得
            date_str = entry_dt.date().isoformat()
            if date_str not in seen_dates:
                cleaned.append(entry)
                seen_dates.add(date_str)
    
    # 再度ソートして返す
    cleaned.sort(key=lambda x: x['timestamp'])
    return cleaned

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
        
        if vid not in history_data:
            history_data[vid] = {
                "info": {
                    "title": snippet['title'],
                    "thumbnail": snippet['thumbnails']['high']['url'],
                    "uploadDate": snippet['publishedAt'],
                    "unit": target_info.get('unit', ''),
                    "character": target_info.get('character', '')
                },
                "history": []
            }
        
        # タイトル等更新
        history_data[vid]["info"]["title"] = snippet['title']
        history_data[vid]["info"]["thumbnail"] = snippet['thumbnails']['high']['url']

        # 履歴に追加
        history_data[vid]["history"].append({
            "timestamp": current_time_jst,
            "views": view_count
        })
        
        # 容量削減: 古いデータを間引く
        history_data[vid]["history"] = clean_history_data(history_data[vid]["history"])

    # 保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    main()
