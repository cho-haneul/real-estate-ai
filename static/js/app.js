// ==========================================================================
// 전국 부동산 & 소득 랭킹 분석 및 AI 질의응답 & 주택 구입 시뮬레이터 스크립트
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    // 상태 변수
    let currentSort = "pir";
    let currentArea = "all";
    let currentSearch = "";
    let cachedRegionsData = [];
    let dynamicChartInstance = null;
    let simChartInstance = null;
    let latestAiResult = null;
    let deferredInstallPrompt = null;

    // DOM 요소 캐싱 - 랭킹 테이블
    const rankingTableBody = document.getElementById("rankingTableBody");
    const rankingSearchInput = document.getElementById("rankingSearchInput");
    const tabButtons = document.querySelectorAll(".tab-btn");
    const filterButtons = document.querySelectorAll(".btn-filter");
    const btnReloadData = document.getElementById("btnReloadData");
    const dataStatusBadge = document.getElementById("dataStatusBadge");

    // DOM 요소 캐싱 - 시뮬레이터
    const simIncome = document.getElementById("simIncome");
    const lblSimIncome = document.getElementById("lblSimIncome");
    const simAssets = document.getElementById("simAssets");
    const lblSimAssets = document.getElementById("lblSimAssets");
    const simSaveRate = document.getElementById("simSaveRate");
    const lblSimSaveRate = document.getElementById("lblSimSaveRate");
    const rateButtons = document.querySelectorAll(".btn-rate");
    const simTargetRegion = document.getElementById("simTargetRegion");
    const simLtv = document.getElementById("simLtv");

    // 시뮬레이터 결과 DOM
    const resTargetRegionName = document.getElementById("resTargetRegionName");
    const resTargetPrice = document.getElementById("resTargetPrice");
    const resPureYears = document.getElementById("resPureYears");
    const resAnnualSavingsText = document.getElementById("resAnnualSavingsText");
    const resGoalPct = document.getElementById("resGoalPct");
    const resGoalBar = document.getElementById("resGoalBar");
    const resNeededMoney = document.getElementById("resNeededMoney");
    const resLtvVal = document.getElementById("resLtvVal");
    const resTimeSaved = document.getElementById("resTimeSaved");
    const resLoanYears = document.getElementById("resLoanYears");
    const resLoanAmount = document.getElementById("resLoanAmount");
    const resMonthlyRepay = document.getElementById("resMonthlyRepay");
    const btnAskAiStrategy = document.getElementById("btnAskAiStrategy");

    // DOM 요소 캐싱 - AI 질의
    const queryForm = document.getElementById("queryForm");
    const queryInput = document.getElementById("queryInput");
    const btnQuerySubmit = document.getElementById("btnQuerySubmit");
    const aiLoadingIndicator = document.getElementById("aiLoadingIndicator");
    const aiLoadingText = document.getElementById("aiLoadingText");
    const aiResultArea = document.getElementById("aiResultArea");
    const dynamicChartTitle = document.getElementById("dynamicChartTitle");
    const aiAnswerContent = document.getElementById("aiAnswerContent");
    const btnCopyAnswer = document.getElementById("btnCopyAnswer");
    const btnDownloadAnswerMd = document.getElementById("btnDownloadAnswerMd");

    // DOM 요소 캐싱 - PWA 앱 설치
    const btnInstallApp = document.getElementById("btnInstallApp");
    const installModal = document.getElementById("installModal");
    const installModalBackdrop = document.getElementById("installModalBackdrop");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const btnModalConfirm = document.getElementById("btnModalConfirm");
    const stepAndroid = document.getElementById("stepAndroid");
    const stepIos = document.getElementById("stepIos");

    // ==========================================================================
    // 0. PWA 서비스 워커 등록 및 설치 프롬프트 바인딩
    // ==========================================================================
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(err => {
            console.log("Service Worker 등록 실패 (무시 가능):", err);
        });
    }

    // 안드로이드 / 크롬 네이티브 설치 프롬프트 캡처
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (btnInstallApp) {
            btnInstallApp.classList.remove("d-none");
        }
    });

    // 앱 설치 버튼 클릭 이벤트
    if (btnInstallApp) {
        btnInstallApp.addEventListener("click", async () => {
            if (deferredInstallPrompt) {
                // 안드로이드 / 크롬 설치 팝업 즉시 실행
                deferredInstallPrompt.prompt();
                const choiceResult = await deferredInstallPrompt.userChoice;
                if (choiceResult.outcome === "accepted") {
                    console.log("사용자가 앱 설치를 수락했습니다.");
                }
                deferredInstallPrompt = null;
            } else {
                // 아이폰 또는 네이티브 프롬프트가 지원되지 않는 경우 모달 가이드 표시
                openInstallModal();
            }
        });
    }

    function openInstallModal() {
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIos) {
            stepIos.style.border = "2px solid #2563eb";
            stepIos.style.background = "#eff6ff";
            stepAndroid.style.opacity = "0.6";
        } else {
            stepAndroid.style.border = "2px solid #10b981";
            stepAndroid.style.background = "#ecfdf5";
            stepIos.style.opacity = "0.6";
        }
        installModal.classList.remove("d-none");
    }

    function closeInstallModal() {
        installModal.classList.add("d-none");
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeInstallModal);
    if (installModalBackdrop) installModalBackdrop.addEventListener("click", closeInstallModal);
    if (btnModalConfirm) btnModalConfirm.addEventListener("click", closeInstallModal);

    // ==========================================================================
    // 1. 초기 랭킹 데이터 로드
    // ==========================================================================
    fetchRankings();

    // 2. 랭킹 데이터 API 호출 및 렌더링
    async function fetchRankings() {
        try {
            rankingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: #64748b;">📊 국세청 소득 및 부동산원 통계 집계 중...</td></tr>`;

            const url = `/api/rankings?sort=${currentSort}&area=${currentArea}&search=${encodeURIComponent(currentSearch)}`;
            const res = await fetch(url);
            const result = await res.json();

            if (!result.success) throw new Error(result.error);

            cachedRegionsData = result.data;
            renderRankingTable(result.data);
            populateSimulatorRegions(result.data);
            calculateSimulation();

            if (dataStatusBadge) {
                dataStatusBadge.textContent = `🟢 국세청 소득 & 부동산원 실거래 데이터 연동 정상 (${result.count}개 지역)`;
            }
        } catch (err) {
            console.error("랭킹 조회 실패:", err);
            rankingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: #ef4444; padding: 2.5rem;">데이터를 불러오지 못했습니다: ${err.message}</td></tr>`;
        }
    }

    // 3. 랭킹 테이블 렌더링 (부동산 & 자산 테마 디자인 적용)
    function renderRankingTable(data) {
        if (!data || data.length === 0) {
            rankingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: #64748b;">조건에 일치하는 지역이 없습니다.</td></tr>`;
            return;
        }

        rankingTableBody.innerHTML = "";

        data.forEach((row, idx) => {
            const rank = idx + 1;
            const tr = document.createElement("tr");
            if (rank === 1) tr.classList.add("row-rank-1");

            // 순위 뱃지 스타일
            let rankBadgeHtml = `<span class="rank-badge rank-other">${rank}</span>`;
            if (rank === 1) rankBadgeHtml = `<span class="rank-badge rank-1" title="1위">🥇</span>`;
            else if (rank === 2) rankBadgeHtml = `<span class="rank-badge rank-2" title="2위">🥈</span>`;
            else if (rank === 3) rankBadgeHtml = `<span class="rank-badge rank-3" title="3위">🥉</span>`;

            // PIR 수준 판정 및 태그
            let levelTag = `<span class="level-tag level-normal">🏡 적정 부담</span>`;
            if (row.pir >= 20) {
                levelTag = `<span class="level-tag level-extreme">🔥 극심한 부담</span>`;
            } else if (row.pir >= 13) {
                levelTag = `<span class="level-tag level-high">⚠️ 높은 부담</span>`;
            }

            // 게이지 바 퍼센트 (PIR 40년을 100% 기준으로 산정)
            const fillPct = Math.min(Math.round((row.pir / 40.0) * 100), 100);

            // 월 환산 추정 소득
            const monthlyIncome = Math.round(row.avg_income_manwon / 12);

            tr.innerHTML = `
                <td style="text-align:center;">${rankBadgeHtml}</td>
                <td>
                    <strong>${row.region}</strong>
                </td>
                <td>
                    <span class="price-chip">💰 ${formatMoney(row.avg_house_price_manwon)}</span>
                </td>
                <td>
                    <strong>${formatMoney(row.avg_income_manwon)}</strong>
                    <span class="income-sub-text">월 환산 ~${monthlyIncome.toLocaleString()}만원</span>
                </td>
                <td>
                    <div class="pir-bar-wrap">
                        <span class="pir-val">${row.pir}년</span>
                        <div class="pir-progress-bg">
                            <div class="pir-progress-fill" style="width: ${fillPct}%;"></div>
                        </div>
                    </div>
                </td>
                <td style="text-align:center;">${levelTag}</td>
            `;

            rankingTableBody.appendChild(tr);
        });
    }

    // ==========================================================================
    // 4. 내 소득 기반 주택 구입 소요 기간 시뮬레이터 로직
    // ==========================================================================

    function populateSimulatorRegions(data) {
        if (!simTargetRegion || !data || data.length === 0) return;
        const currentSelected = simTargetRegion.value || "서울";

        simTargetRegion.innerHTML = "";
        data.forEach(item => {
            const opt = document.createElement("option");
            opt.value = item.region;
            opt.textContent = `${item.region} (평균 ${formatMoney(item.avg_house_price_manwon)})`;
            if (item.region === currentSelected || (currentSelected === "서울" && item.region === "서울")) {
                opt.selected = true;
            }
            simTargetRegion.appendChild(opt);
        });
    }

    function calculateSimulation() {
        if (!cachedRegionsData || cachedRegionsData.length === 0) return;

        const income = parseInt(simIncome.value) || 5000;
        const assets = parseInt(simAssets.value) || 0;
        const saveRatePct = parseInt(simSaveRate.value) || 50;
        const saveRate = saveRatePct / 100.0;
        const ltvPct = parseInt(simLtv.value) || 40;
        const ltv = ltvPct / 100.0;
        const selectedRegion = simTargetRegion.value || "서울";

        lblSimIncome.textContent = formatMoney(income);
        lblSimAssets.textContent = formatMoney(assets);
        lblSimSaveRate.textContent = `${saveRatePct}% 저축`;

        const regionData = cachedRegionsData.find(r => r.region === selectedRegion) || cachedRegionsData[0];
        const targetPrice = regionData.avg_house_price_manwon;

        resTargetRegionName.textContent = `${regionData.region} 기준`;
        resTargetPrice.textContent = formatMoney(targetPrice);

        const annualSaving = income * saveRate;
        const monthlySaving = Math.round(annualSaving / 12.0);
        resAnnualSavingsText.textContent = `연간 ${formatMoney(annualSaving)} (월 약 ${monthlySaving.toLocaleString()}만원) 저축 기준`;

        const neededPureMoney = Math.max(0, targetPrice - assets);
        resNeededMoney.textContent = formatMoney(neededPureMoney);

        const goalPct = Math.min(100, Math.max(0, (assets / targetPrice) * 100)).toFixed(1);
        resGoalPct.textContent = `${goalPct}%`;
        resGoalBar.style.width = `${goalPct}%`;

        if (neededPureMoney <= 0) {
            resPureYears.innerHTML = `즉시 구매 가능! <span class="unit">🎉</span>`;
        } else {
            const pureYearsFloat = neededPureMoney / annualSaving;
            const pureIntYears = Math.floor(pureYearsFloat);
            const pureIntMonths = Math.round((pureYearsFloat - pureIntYears) * 12);
            resPureYears.innerHTML = `${pureIntYears}<span class="unit">년</span> ${pureIntMonths}<span class="unit">개월</span>`;
        }

        resLtvVal.textContent = ltvPct;
        const loanCompareBox = document.getElementById("loanCompareBox");

        if (ltvPct === 0) {
            loanCompareBox.style.display = "none";
        } else {
            loanCompareBox.style.display = "block";
            const maxLoan = targetPrice * ltv;
            const requiredEquity = targetPrice - maxLoan;
            const neededEquitySaving = Math.max(0, requiredEquity - assets);

            if (neededEquitySaving <= 0) {
                resLoanYears.textContent = "종잣돈 충족 완료!";
                resTimeSaved.textContent = "⏱ 즉시 대출 실행 가능";
            } else {
                const loanYearsFloat = neededEquitySaving / annualSaving;
                const loanIntYears = Math.floor(loanYearsFloat);
                const loanIntMonths = Math.round((loanYearsFloat - loanIntYears) * 12);
                resLoanYears.textContent = `${loanIntYears}년 ${loanIntMonths}개월`;

                const pureYearsFloat = neededPureMoney / annualSaving;
                const savedFloat = Math.max(0, pureYearsFloat - loanYearsFloat);
                resTimeSaved.textContent = `⏱ 약 ${savedFloat.toFixed(1)}년 단축!`;
            }

            resLoanAmount.textContent = formatMoney(maxLoan);

            const monthlyPayment = calcMortgagePMT(maxLoan, 0.042, 30);
            resMonthlyRepay.textContent = `월 약 ${monthlyPayment.toLocaleString()}만원`;
        }

        updateSimulatorChart(annualSaving, assets);
    }

    function calcMortgagePMT(principalManwon, annualRate, years) {
        if (principalManwon <= 0) return 0;
        const p = principalManwon * 10000;
        const r = annualRate / 12.0;
        const n = years * 12;
        const pmt = p * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        return Math.round(pmt / 10000);
    }

    function updateSimulatorChart(annualSaving, currentAssets) {
        if (!cachedRegionsData || cachedRegionsData.length === 0) return;

        const benchmarkRegions = ["서울 강남지역 동남권", "서울", "경기 경부1권", "인천", "부산", "대구", "전국"];
        const matchedItems = [];

        benchmarkRegions.forEach(name => {
            const found = cachedRegionsData.find(r => r.region.includes(name) || name.includes(r.region));
            if (found && !matchedItems.includes(found)) {
                matchedItems.push(found);
            }
        });

        if (matchedItems.length < 4) {
            cachedRegionsData.slice(0, 6).forEach(it => {
                if (!matchedItems.includes(it)) matchedItems.push(it);
            });
        }

        const labels = matchedItems.map(it => it.region);
        const yearsData = matchedItems.map(it => {
            const needed = Math.max(0, it.avg_house_price_manwon - currentAssets);
            return parseFloat((needed / annualSaving).toFixed(1));
        });

        const ctxSim = document.getElementById("simComparisonChart").getContext("2d");
        if (simChartInstance) simChartInstance.destroy();

        simChartInstance = new Chart(ctxSim, {
            type: "bar",
            data: {
                labels: labels,
                datasets: [{
                    label: "내 저축 기준 내 집 마련 소요 기간 (년)",
                    data: yearsData,
                    backgroundColor: [
                        "rgba(217, 119, 6, 0.85)",
                        "rgba(37, 99, 235, 0.85)",
                        "rgba(59, 130, 246, 0.85)",
                        "rgba(16, 185, 129, 0.85)",
                        "rgba(16, 185, 129, 0.85)",
                        "rgba(100, 116, 139, 0.85)",
                        "rgba(100, 116, 139, 0.85)"
                    ],
                    borderColor: "#1e293b",
                    borderWidth: 1,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ⏱ 소요 기간: ${ctx.raw}년 (${Math.floor(ctx.raw)}년 ${Math.round((ctx.raw % 1) * 12)}개월)`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: "소요 기간 (년)", font: { weight: "bold" } }
                    },
                    x: {
                        ticks: { font: { family: "Pretendard", weight: "600" } }
                    }
                }
            }
        });
    }

    simIncome.addEventListener("input", calculateSimulation);
    simAssets.addEventListener("input", calculateSimulation);
    simTargetRegion.addEventListener("change", calculateSimulation);
    simLtv.addEventListener("change", calculateSimulation);

    rateButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            rateButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            simSaveRate.value = btn.dataset.rate;
            calculateSimulation();
        });
    });

    btnAskAiStrategy.addEventListener("click", () => {
        const income = simIncome.value;
        const assets = simAssets.value;
        const rate = simSaveRate.value;
        const ltv = simLtv.value;
        const region = simTargetRegion.value;

        const aiQuestion = `내 연간 소득은 ${formatMoney(income)}, 현재 보유 순자산은 ${formatMoney(assets)}, 저축률은 ${rate}%입니다. 목표 희망 지역인 [${region}]에 내 집을 마련하기 위한 최적의 LTV 대출 전략과 현실적인 자산 형성 실행 로드맵을 심층 조언해줘.`;

        queryInput.value = aiQuestion;
        submitQuery(aiQuestion);
    });

    // ==========================================================================
    // 5. 정렬, 필터, 검색 이벤트
    // ==========================================================================
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentSort = btn.dataset.sort;
            fetchRankings();
        });
    });

    filterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentArea = btn.dataset.area;
            fetchRankings();
        });
    });

    let searchTimeout = null;
    rankingSearchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value.trim();
            fetchRankings();
        }, 300);
    });

    document.querySelectorAll(".btn-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            queryInput.value = chip.dataset.q;
            submitQuery(chip.dataset.q);
        });
    });

    // ==========================================================================
    // 6. 질문 폼 제출 처리 (Gemini AI 질의응답)
    // ==========================================================================
    queryForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const question = queryInput.value.trim();
        if (question) {
            submitQuery(question);
        }
    });

    async function submitQuery(question) {
        btnQuerySubmit.disabled = true;
        aiLoadingIndicator.classList.remove("d-none");
        aiResultArea.classList.add("d-none");

        try {
            updateLoadingMsg("실제 국세청 소득 통계 및 한국부동산원 실거래가 정밀 연산 중...");

            const response = await fetch("/api/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question })
            });

            updateLoadingMsg("Gemini 최신 금융 모델이 이코노미스트 자산 분석 리포트를 작성 중입니다...");

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "질의 처리 중 오류가 발생했습니다.");
            }

            latestAiResult = result;

            renderDynamicChart(result.chart_data);

            if (window.marked && typeof marked.parse === "function") {
                aiAnswerContent.innerHTML = marked.parse(result.ai_answer);
            } else {
                aiAnswerContent.innerHTML = `<pre>${result.ai_answer}</pre>`;
            }

            aiResultArea.classList.remove("d-none");
            aiResultArea.scrollIntoView({ behavior: "smooth", block: "start" });

        } catch (error) {
            console.error("AI 질의 실패:", error);
            alert("질문 처리 실패: " + error.message);
        } finally {
            btnQuerySubmit.disabled = false;
            aiLoadingIndicator.classList.add("d-none");
        }
    }

    // 7. 질문 맞춤형 차트 렌더링
    function renderDynamicChart(chartData) {
        if (dynamicChartInstance) dynamicChartInstance.destroy();

        dynamicChartTitle.textContent = `📈 ${chartData.title}`;
        const ctx = document.getElementById("dynamicChart").getContext("2d");

        dynamicChartInstance = new Chart(ctx, {
            type: "bar",
            data: {
                labels: chartData.labels,
                datasets: [
                    {
                        type: "bar",
                        label: "평균 주택매매가 (만원)",
                        data: chartData.prices,
                        backgroundColor: "rgba(37, 99, 235, 0.8)",
                        hoverBackgroundColor: "rgba(29, 78, 216, 0.95)",
                        borderColor: "#1d4ed8",
                        borderWidth: 1.5,
                        borderRadius: 8,
                        yAxisID: "yPrice"
                    },
                    {
                        type: "line",
                        label: "PIR (소득 소요 연수)",
                        data: chartData.pir,
                        borderColor: "#d97706",
                        backgroundColor: "rgba(245, 158, 11, 0.2)",
                        borderWidth: 3.5,
                        pointBackgroundColor: "#ffffff",
                        pointBorderColor: "#d97706",
                        pointBorderWidth: 2.5,
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        tension: 0.3,
                        yAxisID: "yPir"
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "top",
                        labels: {
                            font: { family: "Pretendard", weight: "600", size: 12 },
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: "rgba(15, 23, 42, 0.9)",
                        titleFont: { family: "Pretendard", weight: "bold" },
                        bodyFont: { family: "Pretendard" },
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.dataset.yAxisID === "yPrice") {
                                    return ` 💰 평균 매매가: ${formatMoney(ctx.raw)}`;
                                }
                                return ` ⏳ PIR: ${ctx.raw}년 치 연소득 모아야 함`;
                            }
                        }
                    }
                },
                scales: {
                    yPrice: {
                        type: "linear",
                        position: "left",
                        title: { display: true, text: "주택 매매가 (만원)", font: { weight: "600" } },
                        ticks: {
                            callback: (v) => `${(v / 10000).toFixed(0)}억`
                        },
                        grid: { color: "rgba(226, 232, 240, 0.6)" }
                    },
                    yPir: {
                        type: "linear",
                        position: "right",
                        title: { display: true, text: "PIR (연수)", font: { weight: "600" } },
                        grid: { drawOnChartArea: false }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: "Pretendard", weight: "500" } }
                    }
                }
            }
        });
    }

    // 8. 답변 복사 및 다운로드
    btnCopyAnswer.addEventListener("click", () => {
        if (!latestAiResult) return;
        navigator.clipboard.writeText(latestAiResult.ai_answer).then(() => {
            alert("AI 분석 리포트가 클립보드에 복사되었습니다!");
        });
    });

    btnDownloadAnswerMd.addEventListener("click", () => {
        if (!latestAiResult) return;
        const timestamp = new Date().toISOString().slice(0, 10);
        const fileName = `부동산_자산분석리포트_${timestamp}.md`;
        const content = `# 대한민국 부동산 및 자산 금융 AI 분석 리포트\n\n- 질문: ${latestAiResult.question}\n- 분석 일시: ${new Date().toLocaleString()}\n- 데이터 출처: 국세청 근로소득 및 한국부동산원 실거래가\n\n---\n\n${latestAiResult.ai_answer}`;
        
        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    // 9. 통계 데이터 새로고침 버튼
    btnReloadData.addEventListener("click", async () => {
        btnReloadData.disabled = true;
        btnReloadData.textContent = "⏳ 읽는 중...";
        try {
            const res = await fetch("/api/reload", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                alert(data.message);
                fetchRankings();
            } else {
                alert("새로고침 실패: " + data.error);
            }
        } catch (e) {
            alert("통신 오류: " + e.message);
        } finally {
            btnReloadData.disabled = false;
            btnReloadData.textContent = "🔄 통계 새로고침";
        }
    });

    // 유틸리티 함수: 만원 단위 포맷팅
    function formatMoney(manwon) {
        if (!manwon || manwon === 0) return "0원";
        if (manwon >= 10000) {
            const eok = Math.floor(manwon / 10000);
            const remainder = Math.round(manwon % 10000);
            return remainder > 0 ? `${eok}억 ${remainder.toLocaleString()}만원` : `${eok}억원`;
        }
        return `${Math.round(manwon).toLocaleString()}만원`;
    }

    function updateLoadingMsg(msg) {
        if (aiLoadingText) aiLoadingText.textContent = msg;
    }
});
