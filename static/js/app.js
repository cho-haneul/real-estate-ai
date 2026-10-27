// ==========================================================================
// 전국 부동산 & 소득 랭킹 분석 및 AI 질의응답 프론트엔드 스크립트
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    // 상태 변수
    let currentSort = "pir";
    let currentArea = "all";
    let currentSearch = "";
    let dynamicChartInstance = null;
    let latestAiResult = null;

    // DOM 요소
    const rankingTableBody = document.getElementById("rankingTableBody");
    const rankingSearchInput = document.getElementById("rankingSearchInput");
    const tabButtons = document.querySelectorAll(".tab-btn");
    const filterButtons = document.querySelectorAll(".btn-filter");
    const btnReloadData = document.getElementById("btnReloadData");
    const dataStatusBadge = document.getElementById("dataStatusBadge");

    // AI 질의 DOM 요소
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

    // 1. 초기 랭킹 데이터 로드
    fetchRankings();

    // 2. 랭킹 데이터 API 호출 및 렌더링
    async function fetchRankings() {
        try {
            rankingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">통계 데이터 로딩 중...</td></tr>`;

            const url = `/api/rankings?sort=${currentSort}&area=${currentArea}&search=${encodeURIComponent(currentSearch)}`;
            const res = await fetch(url);
            const result = await res.json();

            if (!result.success) throw new Error(result.error);

            renderRankingTable(result.data);
            if (dataStatusBadge) {
                dataStatusBadge.textContent = `🟢 데이터 연동 정상 (${result.count}개 지역)`;
            }
        } catch (err) {
            console.error("랭킹 조회 실패:", err);
            rankingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: #ef4444; padding: 2rem;">데이터를 불러오지 못했습니다: ${err.message}</td></tr>`;
        }
    }

    // 3. 랭킹 테이블 렌더링
    function renderRankingTable(data) {
        if (!data || data.length === 0) {
            rankingTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">해당 조건에 일치하는 지역이 없습니다.</td></tr>`;
            return;
        }

        rankingTableBody.innerHTML = "";

        data.forEach((row, idx) => {
            const rank = idx + 1;
            const tr = document.createElement("tr");

            // 순위 뱃지 스타일
            let rankBadgeHtml = `<span class="rank-badge rank-other">${rank}</span>`;
            if (rank === 1) rankBadgeHtml = `<span class="rank-badge rank-1">🥇</span>`;
            else if (rank === 2) rankBadgeHtml = `<span class="rank-badge rank-2">🥈</span>`;
            else if (rank === 3) rankBadgeHtml = `<span class="rank-badge rank-3">🥉</span>`;

            // PIR 수준 판정 및 태그
            let levelTag = `<span class="level-tag level-normal">적정 부담</span>`;
            if (row.pir >= 20) {
                levelTag = `<span class="level-tag level-extreme">극심한 부담</span>`;
            } else if (row.pir >= 13) {
                levelTag = `<span class="level-tag level-high">높은 부담</span>`;
            }

            // 게이지 바 퍼센트 (PIR 40년을 100% 기준으로 산정)
            const fillPct = Math.min(Math.round((row.pir / 40.0) * 100), 100);

            tr.innerHTML = `
                <td style="text-align:center;">${rankBadgeHtml}</td>
                <td><strong>${row.region}</strong></td>
                <td>${formatMoney(row.avg_house_price_manwon)}</td>
                <td>${formatMoney(row.avg_income_manwon)}</td>
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

    // 4. 정렬 탭 클릭 이벤트
    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentSort = btn.dataset.sort;
            fetchRankings();
        });
    });

    // 5. 지역 필터 탭 클릭 이벤트
    filterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentArea = btn.dataset.area;
            fetchRankings();
        });
    });

    // 6. 실시간 검색 디바운스
    let searchTimeout = null;
    rankingSearchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value.trim();
            fetchRankings();
        }, 300);
    });

    // 7. 추천 질문 칩 클릭
    document.querySelectorAll(".btn-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            queryInput.value = chip.dataset.q;
            submitQuery(chip.dataset.q);
        });
    });

    // 8. 질문 폼 제출 처리
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
            updateLoadingMsg("실제 국세청 소득 및 한국부동산원 실거래가 통계 수치 연산 중...");

            const response = await fetch("/api/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question })
            });

            updateLoadingMsg("Gemini 1.5 Flash 모델이 통계를 바탕으로 심층 답변을 작성 중입니다...");

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "질의 처리 중 오류가 발생했습니다.");
            }

            latestAiResult = result;

            // 1. 맞춤형 차트 렌더링
            renderDynamicChart(result.chart_data);

            // 2. AI 답변 렌더링 (Markdown 변환)
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

    // 9. 질문 맞춤형 차트 렌더링 (Chart.js 복합 그래프)
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
                        backgroundColor: "rgba(37, 99, 235, 0.75)",
                        borderColor: "#2563eb",
                        borderWidth: 1,
                        borderRadius: 6,
                        yAxisID: "yPrice"
                    },
                    {
                        type: "line",
                        label: "PIR (소득 소요 연수)",
                        data: chartData.pir,
                        borderColor: "#ef4444",
                        backgroundColor: "rgba(239, 68, 68, 0.15)",
                        borderWidth: 3,
                        pointRadius: 6,
                        tension: 0.25,
                        yAxisID: "yPir"
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "top" },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.dataset.yAxisID === "yPrice") {
                                    return `매매가: ${formatMoney(ctx.raw)}`;
                                }
                                return `PIR: ${ctx.raw}년 소득분`;
                            }
                        }
                    }
                },
                scales: {
                    yPrice: {
                        type: "linear",
                        position: "left",
                        title: { display: true, text: "주택 매매가 (만원)" },
                        ticks: {
                            callback: (v) => `${(v / 10000).toFixed(0)}억`
                        }
                    },
                    yPir: {
                        type: "linear",
                        position: "right",
                        title: { display: true, text: "PIR (년)" },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    // 10. 답변 복사 및 다운로드
    btnCopyAnswer.addEventListener("click", () => {
        if (!latestAiResult) return;
        navigator.clipboard.writeText(latestAiResult.ai_answer).then(() => {
            alert("AI 답변 내용이 클립보드에 복사되었습니다!");
        });
    });

    btnDownloadAnswerMd.addEventListener("click", () => {
        if (!latestAiResult) return;
        const timestamp = new Date().toISOString().slice(0, 10);
        const fileName = `부동산_AI답변_${timestamp}.md`;
        const content = `# 부동산 통계 기반 AI 분석 답변\n\n- 질문: ${latestAiResult.question}\n- 일시: ${new Date().toLocaleString()}\n\n---\n\n${latestAiResult.ai_answer}`;
        
        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    // 11. 통계 데이터 새로고침 버튼
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
        if (!manwon) return "0원";
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
