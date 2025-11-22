import os
import json
import datetime
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
    
    # --- 修正箇所: 50件ずつ分割して取得する処理 ---
    all_items = []
    chunk_size = 50
    
    for i in range(0, len(video_ids), chunk_size):
        # 50個のIDを取り出す
        batch_ids = video_ids[i:i + chunk_size]
        
        try:
            response = youtube.videos().list(
                part='snippet,statistics',
                id=','.join(batch_ids)
            ).execute()
            
            # 結果リストに追加
            if 'items' in response:
                all_items.extend(response['items'])
                
        except Exception as e:
            print(f"Error fetching batch {i}: {e}")
            # 一部のバッチが失敗しても止まらないようにする（必要であればraiseしてもOK）
            continue

    # --------------------------------------------
    
    # 既存の履歴データを読み込み（なければ新規作成）
    if os.path.exists(HISTORY_PATH):
        with open(HISTORY_PATH, 'r', encoding='utf-8') as f:
            history_data = json.load(f)
    else:
        history_data = {}

    current_time = datetime.datetime.now().isoformat()

    # データの更新・整形 (all_items を使うように変更)
    for item in all_items:
        vid = item['id']
        stats = item['statistics']
        snippet = item['snippet']
        
        # マスターデータから付加情報を検索
        target_info = next((v for v in video_targets if v['id'] == vid), {})
        
        # viewCount等が非公開の場合は0にする
        view_count = int(stats.get('viewCount', 0))
        
        # 動画ごとのデータ構造
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
        
        # 情報の更新（タイトル等が変更された場合用）
        history_data[vid]["info"]["title"] = snippet['title']
        history_data[vid]["info"]["thumbnail"] = snippet['thumbnails']['high']['url']

        # 履歴に追加
        history_data[vid]["history"].append({
            "timestamp": current_time,
            "views": view_count
        })

        # データ肥大化防止（任意: 最新100件だけ残すなど）
        # history_data[vid]["history"] = history_data[vid]["history"][-100:]

    # 保存
    with open(HISTORY_PATH, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, indent=2, ensure_ascii=False)

if __name__ == '__main__':
    main()
