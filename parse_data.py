import os
import glob
import logging
import pandas as pd
import openpyxl

logger = logging.getLogger(__name__)

def load_integrated_real_estate_data():
    """
    data 폴더 내의 실제 국세청 소득 통계(Excel)와 부동산원 매매가격(CSV)을 결합하여
    전국 시도 및 권역별 주택가격, 평균소득, PIR, 순위 데이터를 생성합니다.
    """
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    
    # 1. 국세청 시도별 근로소득 엑셀 파싱
    excel_files = glob.glob(os.path.join(data_dir, "*근로소득*.xlsx"))
    income_map = {}
    
    if excel_files:
        try:
            wb = openpyxl.load_workbook(excel_files[0], data_only=True)
            ws = wb.active
            for r in range(4, ws.max_row + 1):
                name = ws.cell(row=r, column=1).value
                people = ws.cell(row=r, column=2).value
                total_pay = ws.cell(row=r, column=3).value
                
                if name and people and total_pay:
                    name_clean = str(name).strip()
                    try:
                        p_val = float(str(people).replace(",", ""))
                        pay_val = float(str(total_pay).replace(",", ""))
                        # 급여총계(백만원) * 100 / 인원(명) = 1인당 연평균 소득(만원)
                        avg_income = round((pay_val * 100.0) / p_val, 1)
                        income_map[name_clean] = avg_income
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"근로소득 엑셀 로드 오류: {e}")

    # 기본 전국 평균 소득 (계 또는 4,233만원)
    national_income = income_map.get("계") or income_map.get("전국") or 4233.0

    # 2. 한국부동산원 평균매매가격 CSV 파싱
    price_files = glob.glob(os.path.join(data_dir, "*평균매매가격*.csv"))
    records = []
    
    if price_files:
        try:
            df_p = pd.read_csv(price_files[0], encoding="cp949", header=None)
            latest_idx = df_p.shape[1] - 1  # 최신월 컬럼 (2026.09)
            latest_col_name = str(df_p.iloc[0, latest_idx]).strip()
            
            for idx in range(2, len(df_p)):
                r1 = str(df_p.iloc[idx, 1]).strip()
                r2 = str(df_p.iloc[idx, 2]).strip()
                r3 = str(df_p.iloc[idx, 3]).strip()
                val_raw = df_p.iloc[idx, latest_idx]
                
                if pd.isna(val_raw) or str(val_raw).strip() in ["", "-", "nan"]:
                    continue
                
                try:
                    price_thousand_won = float(str(val_raw).replace(",", "").replace('"', '').strip())
                    # 천원 -> 만원 변환
                    price_manwon = round(price_thousand_won / 10.0, 1)
                except Exception:
                    continue
                
                parts = [p for p in [r1, r2, r3] if p not in ["nan", ""] and not p.startswith("No")]
                unique_parts = []
                for p in parts:
                    if p not in unique_parts:
                        unique_parts.append(p)
                display_name = " ".join(unique_parts) if unique_parts else r1
                
                if not display_name or display_name in ["No", "None"]:
                    continue

                # 지역별 소득 매칭
                matched_income = None
                for inc_name, inc_val in income_map.items():
                    if inc_name in display_name or (display_name in inc_name and len(display_name) >= 2):
                        matched_income = inc_val
                        break
                
                if not matched_income:
                    # 서울 하위 권역인 경우 서울 소득 적용
                    if "서울" in display_name:
                        matched_income = income_map.get("서울", 4937.0)
                    elif "경기" in display_name:
                        matched_income = income_map.get("경기", 4320.0)
                    elif "인천" in display_name:
                        matched_income = income_map.get("인천", 3890.0)
                    elif "부산" in display_name:
                        matched_income = income_map.get("부산", 3950.0)
                    elif "대구" in display_name:
                        matched_income = income_map.get("대구", 3870.0)
                    elif "대전" in display_name:
                        matched_income = income_map.get("대전", 4250.0)
                    elif "광주" in display_name:
                        matched_income = income_map.get("광주", 3980.0)
                    elif "울산" in display_name:
                        matched_income = income_map.get("울산", 4720.0)
                    elif "세종" in display_name:
                        matched_income = income_map.get("세종", 5250.0)
                    else:
                        matched_income = national_income
                        
                pir = round(price_manwon / matched_income, 2)
                hai = round((10.0 / pir) * 100.0, 1) if pir > 0 else 100.0
                
                records.append({
                    "region": display_name,
                    "avg_house_price_manwon": price_manwon,
                    "avg_income_manwon": matched_income,
                    "pir": pir,
                    "affordability_index": hai,
                    "stat_month": latest_col_name
                })
        except Exception as e:
            logger.error(f"평균매매가격 CSV 로드 오류: {e}")

    # 데이터프레임 생성 및 순위 계산
    if records:
        df_result = pd.DataFrame(records)
        # 중복 지역 정리 (가장 상세한 레코드 유지)
        df_result = df_result.drop_duplicates(subset=["region"]).reset_index(drop=True)
        
        # 1. PIR 순위 (높을수록 집 사기 힘든 순)
        df_result = df_result.sort_values(by="pir", ascending=False).reset_index(drop=True)
        df_result["rank_pir"] = range(1, len(df_result) + 1)
        
        # 2. 가격 순위
        df_result = df_result.sort_values(by="avg_house_price_manwon", ascending=False).reset_index(drop=True)
        df_result["rank_price"] = range(1, len(df_result) + 1)
        
        # 3. 소득 순위
        df_result = df_result.sort_values(by="avg_income_manwon", ascending=False).reset_index(drop=True)
        df_result["rank_income"] = range(1, len(df_result) + 1)
        
        # 최종 PIR 순위 기준 정렬
        df_result = df_result.sort_values(by="rank_pir", ascending=True).reset_index(drop=True)
        return df_result
    
    # 만약 파일이 없거나 오류 발생 시 기본 샘플 반환
    return pd.DataFrame()

if __name__ == "__main__":
    df = load_integrated_real_estate_data()
    print("성공적으로 통합된 지역 수:", len(df))
    for idx, row in df.head(10).iterrows():
        print(f"PIR {row['rank_pir']}위: {row['region']} | 매매가: {row['avg_house_price_manwon']:,.0f}만원 | 소득: {row['avg_income_manwon']:,.0f}만원 | PIR: {row['pir']}년")
