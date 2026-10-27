import os
import json
import logging
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai
from parse_data import load_integrated_real_estate_data

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s in %(module)s: %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("Gemini API가 성공적으로 연동되었습니다.")
else:
    logger.warning("GEMINI_API_KEY가 .env 파일에 없습니다.")

# 전역 캐시 데이터프레임
CACHED_DATA = None

def get_data(force_reload=False):
    global CACHED_DATA
    if CACHED_DATA is None or force_reload:
        logger.info("데이터 폴더로부터 통계 자료 파싱 및 통합 수행 중...")
        CACHED_DATA = load_integrated_real_estate_data()
        logger.info(f"통합 완료: 총 {len(CACHED_DATA)}개 지역 통계 준비됨")
    return CACHED_DATA

@app.route("/")
def index():
    """메인 대시보드 페이지"""
    df = get_data()
    total_regions = len(df)
    data_files = [f for f in os.listdir("data") if not f.startswith(".")]
    return render_template("index.html", total_regions=total_regions, data_files=data_files)

@app.route("/api/rankings", methods=["GET"])
def get_rankings():
    """순위별 전체 통계 데이터 반환 (PIR순, 가격순, 소득순 정렬 지원)"""
    sort_by = request.args.get("sort", "pir")  # pir, price, income, affordability
    filter_area = request.args.get("area", "all")  # all, capital(수도권), province(지방)
    search = request.args.get("search", "").strip()

    df = get_data()
    if df.empty:
        return jsonify({"success": False, "error": "데이터를 불러올 수 없습니다."}), 500

    df_filtered = df.copy()

    # 지역 필터
    if filter_area == "capital":
        df_filtered = df_filtered[df_filtered["region"].str.contains("서울|경기|인천|수도권")]
    elif filter_area == "province":
        df_filtered = df_filtered[~df_filtered["region"].str.contains("서울|경기|인천|수도권")]

    # 검색어 필터
    if search:
        df_filtered = df_filtered[df_filtered["region"].str.contains(search)]

    # 정렬
    if sort_by == "pir":
        df_filtered = df_filtered.sort_values(by="pir", ascending=False)
    elif sort_by == "price":
        df_filtered = df_filtered.sort_values(by="avg_house_price_manwon", ascending=False)
    elif sort_by == "income":
        df_filtered = df_filtered.sort_values(by="avg_income_manwon", ascending=False)
    elif sort_by == "affordability":
        df_filtered = df_filtered.sort_values(by="pir", ascending=True)

    records = df_filtered.to_dict(orient="records")
    return jsonify({
        "success": True,
        "count": len(records),
        "data": records
    })

@app.route("/api/query", methods=["POST"])
def query_ai():
    """사용자 질문에 맞는 통계 추출, 맞춤형 차트 구성 및 Gemini AI 답변 생성"""
    try:
        data = request.get_json() or {}
        question = data.get("question", "").strip()

        if not question:
            return jsonify({"success": False, "error": "질문 내용을 입력해 주세요."}), 400

        df = get_data()
        if df.empty:
            return jsonify({"success": False, "error": "통계 데이터가 준비되지 않았습니다."}), 500

        # 상위 10개, 하위 5개 및 주요 통계 데이터 추출
        top_pir = df.sort_values(by="pir", ascending=False).head(10)[["region", "avg_house_price_manwon", "avg_income_manwon", "pir"]].to_dict(orient="records")
        lowest_pir = df.sort_values(by="pir", ascending=True).head(5)[["region", "avg_house_price_manwon", "avg_income_manwon", "pir"]].to_dict(orient="records")
        top_price = df.sort_values(by="avg_house_price_manwon", ascending=False).head(5)[["region", "avg_house_price_manwon", "pir"]].to_dict(orient="records")

        # 질문에 관련된 특정 지역이 포함되어 있는지 확인
        matched_regions = []
        for reg in df["region"].tolist():
            if reg in question or any(sub in question for sub in reg.split()):
                matched_regions.append(reg)
        
        specific_stats = []
        if matched_regions:
            specific_stats = df[df["region"].isin(matched_regions)][["region", "avg_house_price_manwon", "avg_income_manwon", "pir", "rank_pir"]].to_dict(orient="records")

        # 질문 맞춤형 차트 데이터 자동 생성 (Chart.js용)
        # 만약 특정 지역이 언급되었다면 해당 지역 및 상위권 대조, 아니면 상위 10개 PIR 비교
        if specific_stats and len(specific_stats) >= 2:
            chart_regions = [r["region"] for r in specific_stats]
            chart_pir = [r["pir"] for r in specific_stats]
            chart_prices = [r["avg_house_price_manwon"] for r in specific_stats]
            chart_incomes = [r["avg_income_manwon"] for r in specific_stats]
            chart_title = f"질문 언급 지역 비교: {', '.join(chart_regions)}"
        elif "가성비" in question or "낮은" in question or "쉬운" in question:
            chart_subset = df.sort_values(by="pir", ascending=True).head(8)
            chart_regions = chart_subset["region"].tolist()
            chart_pir = chart_subset["pir"].tolist()
            chart_prices = chart_subset["avg_house_price_manwon"].tolist()
            chart_incomes = chart_subset["avg_income_manwon"].tolist()
            chart_title = "PIR 부담이 가장 적은(내 집 마련이 수월한) 지역 Top 8"
        else:
            chart_subset = df.sort_values(by="pir", ascending=False).head(8)
            chart_regions = chart_subset["region"].tolist()
            chart_pir = chart_subset["pir"].tolist()
            chart_prices = chart_subset["avg_house_price_manwon"].tolist()
            chart_incomes = chart_subset["avg_income_manwon"].tolist()
            chart_title = "PIR(소득 대비 주택가격) 상위 8개 지역"

        chart_data = {
            "title": chart_title,
            "labels": chart_regions,
            "pir": chart_pir,
            "prices": chart_prices,
            "incomes": chart_incomes
        }

        # Gemini 모델 호출 (최신 3.5 Flash Lite 및 3 Flash 지원)
        if not GEMINI_API_KEY:
            ai_answer = "Gemini API Key가 .env에 설정되지 않아 실시간 AI 답변을 생성하지 못했습니다. 상단 차트와 통계 수치를 참고해 주세요."
        else:
            prompt = f"""
당신은 대한민국 최고 수준의 부동산 및 금융 통계 수석 이코노미스트입니다.
사용자가 제공한 실제 '국세청 근로소득 통계' 및 '한국부동산원 주택 평균 매매가격' 데이터셋을 바탕으로 사용자의 질문에 정확하고 명쾌하게 답변하세요.

### 현재 로드된 실제 데이터 요약:
- PIR(집값/소득) 가장 높은 지역 Top 10:
{json.dumps(top_pir, ensure_ascii=False, indent=2)}

- PIR 가장 낮은(가성비 높은) 지역 Top 5:
{json.dumps(lowest_pir, ensure_ascii=False, indent=2)}

- 매매가격 가장 높은 지역 Top 5:
{json.dumps(top_price, ensure_ascii=False, indent=2)}

{f"- 사용자가 질문에서 언급한 특정 지역 데이터:\n{json.dumps(specific_stats, ensure_ascii=False, indent=2)}" if specific_stats else ""}

### 사용자 질문:
"{question}"

### 작성 지침:
1. 반드시 위의 **실제 통계 수치(매매가 만원, 연소득 만원, PIR 연수)**를 직접 인용하여 신뢰도 높은 답변을 작성하세요.
2. 질문자가 궁금해하는 핵심 결론을 첫 문단에서 두괄식으로 명쾌하게 제시하세요.
3. 숫자를 설명할 때는 '10억 3,419만원', '연봉 4,937만원 기준 약 21년 소요'처럼 일반인이 한눈에 체감할 수 있도록 친절하게 풀어서 설명하세요.
4. 현실적인 내 집 마련 전략 및 대출/주거 가이드라인을 함께 조언하세요.
5. 읽기 쉬운 깔끔한 마크다운(소제목, 불릿, 굵은 글씨, 강조 박스) 서식으로 작성하세요.
"""
            candidate_models = ["gemini-3.5-flash-lite", "gemini-3-flash-preview", "gemini-3.8-flash"]
            ai_answer = None
            last_err = None

            for m_name in candidate_models:
                try:
                    logger.info(f"Gemini API 모델 시도: {m_name}")
                    model = genai.GenerativeModel(m_name)
                    response = model.generate_content(prompt)
                    if response and response.text:
                        ai_answer = response.text
                        logger.info(f"Gemini API 답변 생성 완료 ({m_name})")
                        break
                except Exception as model_err:
                    logger.warning(f"모델 {m_name} 호출 실패: {model_err}")
                    last_err = model_err

            if not ai_answer:
                raise Exception(f"AI 모델 응답 생성 실패: {last_err}")

        return jsonify({
            "success": True,
            "question": question,
            "ai_answer": ai_answer,
            "chart_data": chart_data
        })

    except Exception as e:
        logger.error(f"질의 처리 중 오류 발생: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"분석 중 오류가 발생했습니다: {str(e)}"}), 500

@app.route("/api/reload", methods=["POST"])
def reload_data():
    """data 폴더의 파일을 다시 스캔하여 즉시 메모리 갱신"""
    try:
        df = get_data(force_reload=True)
        return jsonify({
            "success": True,
            "message": f"통계 데이터가 성공적으로 갱신되었습니다. (총 {len(df)}개 지역)",
            "count": len(df)
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    logger.info("부동산 통계 순위 및 AI 질의응답 서버 구동 중: http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
