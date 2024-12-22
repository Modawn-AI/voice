import requests
import time
import json
import os

# Hume API key
API_KEY = "sUC9tlDDYIqEX4NSGYZf9pVDyNL4st4AUY7HExi08geuYXew"

# Local file path (replace with your actual file path)
FILE_PATH = "/home/ubuntu/modawn_voice/voice/yes-2.wav"

# Endpoint URLs
JOB_ENDPOINT = "https://api.hume.ai/v0/batch/jobs"
RESULT_ENDPOINT_TEMPLATE = "https://api.hume.ai/v0/batch/jobs/{job_id}/predictions"

# Step 1: Submit the inference job with a local file
def submit_job():
    headers = {
        "X-Hume-Api-Key": API_KEY,
    }

    # Prepare the multipart form data
    files = {
        "file": (os.path.basename(FILE_PATH), open(FILE_PATH, "rb"), "audio/wav")
    }

    data = {
        "models": json.dumps({"prosody": {}}),  # models must be sent as a JSON string
        "notify": "true"
    }

    print("🔄 Submitting inference job...")
    response = requests.post(JOB_ENDPOINT, headers=headers, files=files, data=data)

    if response.status_code == 200:
        job_info = response.json()
        job_id = job_info.get("job_id")
        print(f"✅ Job submitted successfully! Job ID: {job_id}")
        return job_id
    else:
        print(f"❌ Error submitting job: {response.text}")
        return None

# Step 2: Poll the job status until it is complete
def wait_for_job_completion(job_id, polling_interval=0.5):
    headers = {
        "X-Hume-Api-Key": API_KEY
    }

    result_url = RESULT_ENDPOINT_TEMPLATE.format(job_id=job_id)

    print(f"⏳ Waiting for job {job_id} to complete...")
    while True:
        response = requests.get(result_url, headers=headers)

        if response.status_code == 200:
            print("✅ Job completed! Fetching results...")
            results = response.json()
            print("📝 Results fetched:", json.dumps(results, indent=2))
            return results
        elif response.status_code == 400:
            print("🕒 Job is still in progress. Waiting...")
            time.sleep(polling_interval)
        else:
            print(f"❌ Error checking job status: {response.text}")
            return None

# Step 3: Save results to a text file
def save_results(results, output_file="hume_results.txt"):
    if results:
        with open(output_file, "w") as f:
            json.dump(results, f, indent=2)
        print(f"💾 Results saved to {output_file}")
    else:
        print("❌ No results to save.")

# Main function to execute the steps
def main():
    start_time = time.time()  # Start the timer

    job_id = submit_job()
    if job_id:
        results = wait_for_job_completion(job_id)
        if results:
            save_results(results)

    end_time = time.time()  # End the timer
    total_time = end_time - start_time
    print(f"⏱️ Total execution time: {total_time:.2f} seconds")

if __name__ == "__main__":
    main()
