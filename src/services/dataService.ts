import type { DataResponse } from '../types'

export async function fetchVideoData(): Promise<DataResponse> {
  try {
    const res = await fetch('/data/videos.json', { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch data: ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching data', error);
    throw error;
  }
}
