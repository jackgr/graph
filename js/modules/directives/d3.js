// TODO(duftler): Remove mockDataService dependency once 'Samples' section is removed from canvas context menu.
angular.module('krakenApp.Graph')
    .directive('d3Visualization', ['lodash', 'd3Service', 'mockDataService', '$location',
                                   'inspectNodeService',
                                   function (lodash, d3Service, mockDataService, $location, inspectNodeService) {
  return {
    restrict: 'E',
    link: function (scope, element, attrs) {
      scope.$watch("viewModelService.viewModel.version", function(newValue, oldValue) {
        d3Service.d3().then(drawNewModel);
      });

      scope.$watch("selectionIdList", function(newValue, oldValue) {
        if (newValue !== undefined) {
          selectJustTheseNodes(newValue);
        }
      });

      var viewSettingsCache = {};
      var nodeSettingsCache = {};

      var selection = {};
      selection.nodes = new Set();
      selection.edges = new Set();
      selection.edgelabels = new Set();

      var node;
      var link;
      var edgelabels;

      var force;

      var selectJustTheseNodes = function(idList) {
        selection.nodes = new Set();

        idList.forEach(function (e) {
          selection.nodes.add({id: e});
        });

        selectEdgesInScope();

        applySelectionToOpacity();
      };

      function selectEdgesInScope() {
        selection.edges.clear();
        selection.edgelabels.clear();

        // Add each edge where both the source and target nodes are selected.
        if (link) {
          link.each(function (e) {
            if (setHas(selection.nodes, e.source) && setHas(selection.nodes, e.target)) {
              selection.edges.add(e);
            }
          });
        }

        // Add each edge label where both the source and target nodes are selected.
        if (edgelabels) {
          edgelabels.each(function (e) {
            if (setHas(selection.nodes, e.source) && setHas(selection.nodes, e.target)) {
              selection.edgelabels.add(e);
            }
          });
        }
      }

      function applySelectionToOpacity() {
        var notSelectedOpacity = 0.2;

        // If nothing is selected, show everything.
        if (!selection.nodes.size && !selection.edges.size && !selection.edgelabels.size) {
          notSelectedOpacity = 1;
        }

        // Reduce the opacity of all but the selected nodes.
        node.style("opacity", function (e) {
          var newOpacity = setHas(selection.nodes, e) ? 1 : notSelectedOpacity;

          if (e.origOpacity) {
            e.origOpacity = newOpacity;
          }

          return newOpacity;
        });

        // Reduce the opacity of all but the selected edges.
        if (link) {
          link.style("opacity", function (e) {
            return setHas(selection.edges, e) ? 1 : notSelectedOpacity;
          });
        }

        // Reduce the opacity of all but the selected edge labels.
        if (edgelabels) {
          edgelabels.style("opacity", function (e) {
            return setHas(selection.edgelabels, e) ? 1 : notSelectedOpacity;
          });
        }

        var selectionIdList = [];

        selection.nodes.forEach(function (e) {
          if (e.id !== undefined) {
            selectionIdList.push(e.id);
          }
        });

        scope.viewModelService.viewModel.configuration.selectionIdList = selectionIdList;

        _.defer(function() {
          scope.$apply();
        });
      }

      // Match on Set.has() or id.
      function setHas(searchSet, item) {
        if (searchSet.has(item)) {
          return true;
        }

        var found = false;

        searchSet.forEach(function (e) {
          if (e.id !== undefined && e.id === item.id) {
            found = true;
            return;
          }
        });

        return found;
      }

      var drawNewModel = function() {
        if (force) {
          force.stop();
        }

        draw();
      }

      var draw = function() {
        var d3 = window.d3;
        d3.select(window).on('resize', resize);

        var containerDimensions = getContainerDimensions();

        // TODO(duftler): Derive the svg height from the container rather than the other way around.
        var width = containerDimensions[0] - 16,
          height = 700,
          center = [width / 2, height / 2];

        var color = d3.scale.category20();

        d3.select(element[0]).select("svg").remove();

        var svg = d3.select(element[0])
          .append("svg")
          .attr("width", width)
          .attr("height", height)
          .attr("class", "graph");

        svg.append("defs").selectAll("marker")
          .data(["suit", "licensing", "resolved"])
          .enter().append("marker")
          .attr("id", function(d) { return d; })
          .attr("viewBox", "0 -5 10 10")
          .attr("refX", 60)
          .attr("refY", 0)
          .attr("markerWidth", 6)
          .attr("markerHeight", 6)
          .attr("orient", "auto")
          .attr("markerUnits", "userSpaceOnUse")
          .append("path")
          .attr("d", "M0,-5L10,0L0,5 L10,0 L0, -5")
          .style("stroke", "black")
          .style("opacity", "1");

        svg.on('contextmenu', function (data, index) {
          d3.selectAll('.popup-tags-table').style("display", "none");

          if (d3.select('.d3-context-menu').style('display') !== 'block') {
            showContextMenu(data, index, canvasContextMenu);
          }
        });

        var zoom = d3.behavior.zoom()
            .scaleExtent([0.5, 12])
            .on("zoom", zoomed);

        if (viewSettingsCache.translate && viewSettingsCache.scale) {
          zoom.translate(viewSettingsCache.translate).scale(viewSettingsCache.scale);
        }

        var g = svg.append("g");

        svg.call(zoom).on("dblclick.zoom", null).call(zoom.event);

        var origWheelZoomHandler = svg.on("wheel.zoom");
        svg.on("wheel.zoom", wheelScrollHandler);

        var showPin = 0;

        d3.select("body")
          .on("keydown", function() {
            if (d3.event.ctrlKey) {
              svg.on("wheel.zoom", origWheelZoomHandler);
              svg.attr("class", "graph zoom-cursor");
            } else if (d3.event.metaKey) {
              showPin |= 4;

              if (showPin === 6) {
                svg.attr("class", "graph pin-cursor");
              }
            }
          })
          .on("keyup", function() {
            if (!d3.event.ctrlKey) {
              svg.on("wheel.zoom", wheelScrollHandler);
              svg.attr("class", "graph");
            }

            if (!d3.event.metaKey) {
              showPin &= ~4;
              svg.attr("class", "graph ");
            }
          });

        var drag = d3.behavior.drag()
          .origin(function(d) { return d; })
          .on("dragstart", dragstarted)
          .on("drag", dragmove)
          .on("dragend", dragended);

        var graph = undefined;
        if (scope.viewModelService) {
          graph = scope.viewModelService.viewModel.data;
        }

        if (graph === undefined) {
          return;
        }

        force = d3.layout.force()
          .size([width, height])
          .on("tick", tick);

        if (graph.settings.clustered) {
          // TODO(duftler): Externalize these values.
          force.gravity(0.02)
            .charge(0);
        } else {
          // TODO(duftler): Externalize these values.
          force.gravity(0.40)
            .charge(-1250)
            .linkDistance(function (d) {
              return d.distance;
            }).links(graph.links);

          // Create all the line svgs but without locations yet.
          link = g.selectAll(".link")
            .data(graph.links)
            .enter().append("line")
            .attr("class", "link")
            .style("marker-end", function (d) {
              if (d.directed) {
                return "url(#suit)";
              }

              return "none";
            })
            .style("stroke", function (d) {
              return d.stroke;
            })
            .style("stroke-dasharray", function (d) {
              return d.dash ? (d.dash + ", " + d.dash) : ("1, 0");
            })
            .style("stroke-width", function (d) {
              return d.width;
            });
        }

        var newPositionCount = 0;
        var selectedNodeSet = new Set();

        graph.nodes.forEach(function (n) {
          var cachedSettings;

          if (n.id) {
            cachedSettings = nodeSettingsCache[n.id];
          }

          if (n.fixed) {
            n.fixed = 8;
          } else if (cachedSettings && cachedSettings.fixed) {
            n.fixed = 8;
          }

          if (n.position) {
            n.x = n.position[0];
            n.y = n.position[1];

            ++newPositionCount;
          } else if (cachedSettings) {
            var cachedPosition = cachedSettings.position;

            if (cachedPosition) {
              n.x = cachedPosition[0];
              n.y = cachedPosition[1];
            }
          }

          if (!n.x && !n.y) {
            var radius = graph.nodes.length * 3;
            var startingPosition = getRandomStartingPosition(radius);

            n.x = center[0] + startingPosition[0];
            n.y = center[1] + startingPosition[1];

            ++newPositionCount;
          }

          if (n.selected && n.id !== 'undefined') {
            selectedNodeSet.add({id: n.id});
          }
        });

        // If any nodes in the graph are explicitly selected, the cached selection is overridden.
        if (selectedNodeSet.size) {
          selection.nodes = selectedNodeSet;
        }

        force.nodes(graph.nodes);

        // TODO(duftler): Remove this after we investigate why so many new id's are returned on 'Refresh'.
        console.log("graph.nodes.length=" + graph.nodes.length + " newPositionCount=" + newPositionCount);

        if (newPositionCount < (0.25 * graph.nodes.length)) {
          force.start().alpha(0.01);
        } else {
          force.start();
        }

        var maxRadius = -1;

        function buildClusters(nodes) {
          var maxCluster = -1;

          nodes.forEach(function (d) {
            maxCluster = Math.max(maxCluster, d.cluster);
            maxRadius = Math.max(maxRadius, d.radius);
          });

          var clusters = new Array(maxCluster + 1);

          nodes.forEach(function (d) {
            if (!clusters[d.cluster] || (d.radius > clusters[d.cluster].radius)) {
              clusters[d.cluster] = d;
            }
          });

          return clusters;
        }

        // The largest node for each cluster.
        var clusters;

        if (graph.settings.clustered) {
          clusters = buildClusters(graph.nodes);
        }

        node = g.selectAll(".node")
          .data(graph.nodes)
          .enter().append("g")
          .attr("class", "node")
          .on("mouseover", d3_layout_forceMouseover)
          .on("mouseout", d3_layout_forceMouseout)
          .on("mouseup", mouseup)
          .call(drag);

        function mouseup(d) {
          if (!d3.event.metaKey) {
            if (d.dragMoved === undefined || !d.dragMoved) {
              connectedNodes(d);
            }
          } else {
            togglePinned(d);
          }
        }

        // create the div element that will hold the context menu
        d3.selectAll('.d3-context-menu').data([1])
            .enter()
            .append('div')
            .attr('class', 'd3-context-menu');

        // close menu
        d3.select('body').on('click.d3-context-menu', function() {
          d3.select('.d3-context-menu').style('display', 'none');
        });

        d3.selectAll('.popup-tags-table').data([1])
          .enter()
          .append('div')
          .attr('class', 'popup-tags-table')
          .style('display', 'none');

        d3.select('body').on('click.popup-tags-table', function() {
          d3.selectAll('.popup-tags-table').style('display', 'none');
        });

        node.each(function (n) {
          var singleNode = d3.select(this);

          if (n.icon) {
            singleNode.append("image")
              .attr("xlink:href", function (d) {
                return d.icon;
              })
              .attr("width", function (d) {
                return d.size[0];
              })
              .attr("height", function (d) {
                return d.size[1];
              })
              .on("dblclick", inspectNode)
              .on("mouseout", function () {
                // Interrupt any pending transition on this node.
                d3.selectAll('.popup-tags-table').transition();
              });
          } else {
            singleNode.append("circle")
              .attr("r", function (d) {
                return d.radius;
              })
              .style("stroke", function (d) {
                return d.stroke;
              })
              .style("fill", function (d) {
                return d.fill;
              })
              .on("dblclick", inspectNode)
              .on("mouseout", function () {
                // Interrupt any pending transition on this node.
                d3.selectAll('.popup-tags-table').transition();
              });
          }
        });

        var text = node.append("text")
          .attr("dx", 10)
          .attr("dy", ".35em");

        text.text(function (d) {
            return graph.settings.showNodeLabels && !d.hideLabel ? d.name : "";
          });

        text.each(function (e) {
          var singleText = d3.select(this);
          var parentNode = singleText.node().parentNode;

          d3.select(parentNode).append("image")
            .attr("xlink:href", function (d) {
              return "/components/graph/img/Pin.svg";
            })
            .attr("display", function (d) {
              return d.fixed & 8 ? "" : "none";
            })
            .attr("width", function (d) {
              return "13px";
            })
            .attr("height", function (d) {
              return "13px";
            });
        });

        if (!graph.settings.clustered && graph.settings.showEdgeLabels) {
          var edgepaths = g.selectAll(".edgepath")
            .data(graph.links)
            .enter()
            .append('path')
            .attr({
              'd': function (d) {
                return 'M ' + d.source.x + ' ' + d.source.y + ' L ' + d.target.x + ' ' + d.target.y;
              },
              'class': 'edgepath',
              'fill-opacity': 0,
              'stroke-opacity': 0,
              'fill': 'blue',
              'stroke': 'red',
              'id': function (d, i) {
                return 'edgepath' + i
              }
            })
            .style("pointer-events", "none");

          edgelabels = g.selectAll(".edgelabel")
            .data(graph.links)
            .enter()
            .append('text')
            .style("pointer-events", "none")
            .attr({
              'class': 'edgelabel',
              'id': function (d, i) {
                return 'edgelabel' + i
              },
              'dx': function (d) {
                return d.distance / 3
              },
              'dy': 0
            });

          edgelabels.append('textPath')
            .attr('xlink:href', function (d, i) {
              return '#edgepath' + i
            })
            .style("pointer-events", "none")
            .text(function (d, i) {
              return d.label
            });
        }

        var circle = g.selectAll("circle");

        if (graph.settings.clustered && newPositionCount) {
          circle.transition()
            .duration(750)
            .delay(function (d, i) {
              return i * 5;
            })
            .attrTween("r", function (d) {
              var i = d3.interpolate(0, d.radius);
              return function (t) {
                return d.radius = i(t);
              };
            });
        }

        // If zero nodes are in the current selection, reset the selection.
        var nodeMatches = new Set();

        node.each(function (e) {
          if (setHas(selection.nodes, e)) {
            nodeMatches.add(e);
          }
        });

        if (!nodeMatches.size) {
          resetSelection();
        } else {
          selection.nodes = nodeMatches;

          selectEdgesInScope();

          applySelectionToOpacity();
        }

        function showContextMenu(data, index, contextMenu) {
          var elm = this;

          d3.selectAll('.d3-context-menu').html('');
          var list = d3.selectAll('.d3-context-menu').append('ul');
          list.selectAll('li').data(contextMenu).enter()
              .append('li')
              .html(function (d) {
                return (typeof d.title === 'string') ? d.title : d.title(data);
              })
              .on('click', function (d, i) {
                d.action(elm, data, index);
                d3.select('.d3-context-menu').style('display', 'none');
              });

          // display context menu
          d3.select('.d3-context-menu')
              .style('left', (d3.event.pageX - 2) + 'px')
              .style('top', (d3.event.pageY - 2) + 'px')
              .style('display', 'block');

          d3.event.preventDefault();
        }

        function showPopupTagsTable(n) {
          d3.selectAll('.popup-tags-table').html('');

          if (n.tags && Object.keys(n.tags)) {
            var mdItem = d3
              .selectAll('.popup-tags-table')
              .append("md-content")
              .append("md-list")
              .selectAll("md-item")
              .data(Object.keys(n.tags))
              .enter()
              .append("md-item");

            var div = mdItem
              .append("md-item-content")
              .append("div");

            div.append("h4")
              .text(function (d) {
                return d;
              });

            var p = div
              .append("a")
              .attr("class", function (d) {
                if (d !== null
                    && (typeof n.tags[d] === 'object' || n.tags[d].toString().indexOf("http://") === 0)) {
                  return "";
                } else {
                  return "not-a-link";
                }
              })
              .attr("href", function (d) {
                if (d !== null && typeof n.tags[d] === 'object') {
                  // TODO(duftler): Update this to reflect new route/pattern defined by Xin.
                  return ".";
                } else if (d !== null && n.tags[d].toString().indexOf("http://") === 0) {
                  return n.tags[d];
                } else {
                  return "";
                }
              })
              .append("p");

            p.text(function (d) {
              if (d !== null && typeof n.tags[d] === 'object') {
                return "Inspect";
              } else {
                return n.tags[d];
              }
            });

            p.on('click', function (d, i) {
              if (typeof n.tags[d] === 'object') {
                d3.event.preventDefault();
                d3.select('.popup-tags-table').style('display', 'none');

                inspectNode(n, d);
              }
            });


            var i = 0;
            for (i = 0; i < mdItem.size() - 1; ++i) {
              d3.select(mdItem[0][i]).append("md-divider");
            }

            d3.selectAll('.popup-tags-table')
              .style('left', (d3.event.pageX - 2) + 'px')
              .style('top', (d3.event.pageY - 2) + 'px');

            d3.selectAll('.popup-tags-table')
              .style('display', 'block');
          }
        }

        // Create an array logging what is connected to what.
        var linkedByIndex = {};
        for (i = 0; i < graph.nodes.length; i++) {
          linkedByIndex[i + "," + i] = 1;
        }

        if (graph.links) {
          graph.links.forEach(function (d) {
            linkedByIndex[d.source.index + "," + d.target.index] = 1;
          });
        }

        // This function looks up whether a pair are neighbours.
        function neighboring(a, b) {
          // TODO(duftler): Add support for > 1 hops.
          if (scope.viewModelService.viewModel.configuration.selectionHops) {
            return linkedByIndex[a.index + "," + b.index];
          } else {
            return false;
          }
        }

        function connectedNodes(d) {
          // Operation is to select nodes if either no nodes are currently selected or this node is not selected.
          var selectOperation = !selection.nodes.size || !setHas(selection.nodes, d);

          if (selectOperation) {
            // Add the double-clicked node.
            selection.nodes.add(d);

            // Add each node within 1 hop from the double-clicked node.
            node.each(function (e) {
              if (neighboring(d, e) | neighboring(e, d)) {
                selection.nodes.add(e);
              }
            });

            selectEdgesInScope();
          } else {
            // De-select the double-clicked node.
            selection.nodes.delete(d);

            // Remove each node within 1 hop from the double-clicked node.
            node.each(function (e) {
              if (neighboring(d, e) | neighboring(e, d)) {
                selection.nodes.delete(e);
              }
            });

            selectEdgesInScope();
          }

          applySelectionToOpacity();
        }

        function resetSelection() {
          // Show everything.
          selection.nodes.clear();
          selection.edges.clear();
          selection.edgelabels.clear();

          applySelectionToOpacity();
        }

        // Now we are giving the SVGs co-ordinates - the force layout is generating the co-ordinates which this code is using to update the attributes of the SVG elements.
        function tick(e) {
          node.style("opacity", function (e) {
            if (e.opacity) {
              var opacity = e.opacity;

              delete e.opacity;

              return opacity;
            }

            return d3.select(this).style("opacity");
          });

          if (graph.settings.clustered) {
            circle
              .each(cluster(10 * force.alpha() * force.alpha()))
              .each(collide(.5))
              .attr("cx", function (d) {
                return d.x;
              })
              .attr("cy", function (d) {
                return d.y;
              });
          } else {
            link
              .attr("x1", function (d) {
                var offsetX = d.source.icon ? d.source.size[0] / 2 : 0;

                return d.source.x + offsetX;
              })
              .attr("y1", function (d) {
                var offsetY = d.source.icon ? d.source.size[1] / 2 : 0;

                return d.source.y + offsetY;
              })
              .attr("x2", function (d) {
                var offsetX = d.target.icon ? d.target.size[0] / 2 : 0;

                return d.target.x + offsetX;
              })
              .attr("y2", function (d) {
                var offsetY = d.target.icon ? d.target.size[1] / 2 : 0;

                return d.target.y + offsetY;
              });

            g.selectAll("circle")
              .attr("cx", function (d) {
                return d.x;
              })
              .attr("cy", function (d) {
                return d.y;
              });

            if (force.alpha() < 0.04) {
              graph.nodes.forEach(function (n) {
                if (n.id) {
                  if (!nodeSettingsCache[n.id]) {
                    nodeSettingsCache[n.id] = {};
                  }

                  nodeSettingsCache[n.id].position = [n.x, n.y];
                }
              });
            }

            var image = d3.selectAll("image");

            image.each(function (e) {
              var singleImage = d3.select(this);
              var siblingText = d3.select(singleImage.node().parentNode).select("text");
              var bbox = siblingText[0][0] ? siblingText[0][0].getBBox() : null;
              var isPinIcon = singleImage.attr("xlink:href") === "/components/graph/img/Pin.svg";

              singleImage
                .attr("display", function (d) {
                  if (isPinIcon) {
                    return d.fixed & 8 ? "" : "none";
                  } else {
                    return "";
                  }
                });

              singleImage
                .attr("x", function (d) {
                  if (isPinIcon) {
                    if (siblingText.text() !== "") {
                      return d.x + bbox.width + 12;
                    } else {
                      return d.x - 5;
                    }
                  } else {
                    return d.x
                  }
                })
                .attr("y", function (d) {
                  if (isPinIcon) {
                    return d.y - 5;
                  } else {
                    return d.y;
                  }
                });
            });

            if (edgepaths) {
              edgepaths.attr('d', function (d) {
                var path = 'M ' + d.source.x + ' ' + d.source.y + ' L ' + d.target.x + ' ' + d.target.y;
                return path
              });

              edgelabels.attr('transform', function (d, i) {
                if (d.target.x < d.source.x) {
                  bbox = this.getBBox();
                  rx = bbox.x + bbox.width / 2;
                  ry = bbox.y + bbox.height / 2;
                  return 'rotate(180 ' + rx + ' ' + ry + ')';
                }
                else {
                  return 'rotate(0)';
                }
              });
            }
          }

          d3.selectAll("text")
            .attr("x", function (d) {
              return d.x;
            })
            .attr("y", function (d) {
              return d.y;
            });
        }

        // Move d to be adjacent to the cluster node.
        function cluster(alpha) {
          return function (d) {
            var cluster = clusters[d.cluster];
            if (cluster === d) return;
            if (d.x == cluster.x && d.y == cluster.y) {
              d.x += 0.1;
            }
            var x = d.x - cluster.x,
              y = d.y - cluster.y,
              l = Math.sqrt(x * x + y * y),
              r = d.radius + cluster.radius;
            if (l != r) {
              l = (l - r) / l * alpha;
              d.x -= x *= l;
              d.y -= y *= l;
              cluster.x += x;
              cluster.y += y;
            }
          };
        }

        var getClusterSettingsPadding = function(graph) {
          // TODO: externalize this default.
          var result = 4;
          if (graph.settings.clusterSettings && graph.settings.clusterSettings.padding !== undefined) {
            var result = graph.settings.clusterSettings.padding;
          }

          return result;
        }

        var getClusterSettingsClusterPadding = function(graph) {
          // TODO: externalize this default.
          var result = 32; 
          if (graph.settings.clusterSettings && graph.settings.clusterSettings.clusterPadding !== undefined) {
            var padding = graph.settings.clusterSettings.padding;
          }

          return result;
        }

        // Resolves collisions between d and all other circles.
        function collide(alpha) {
          var quadtree = d3.geom.quadtree(graph.nodes);
          return function (d) {
            var r = d.radius + maxRadius + Math.max(getClusterSettingsPadding(graph), getClusterSettingsClusterPadding(graph)),
              nx1 = d.x - r,
              nx2 = d.x + r,
              ny1 = d.y - r,
              ny2 = d.y + r;
            quadtree.visit(function (quad, x1, y1, x2, y2) {
              if (quad.point && (quad.point !== d)) {
                var x = d.x - quad.point.x,
                  y = d.y - quad.point.y,
                  l = Math.sqrt(x * x + y * y),
                  r = d.radius + quad.point.radius + (d.cluster === quad.point.cluster ? getClusterSettingsPadding(graph) : getClusterSettingsClusterPadding(graph));
                if (l < r) {
                  l = (l - r) / l * alpha;
                  d.x -= x *= l;
                  d.y -= y *= l;
                  quad.point.x += x;
                  quad.point.y += y;
                }
              }
              return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
            });
          };
        }

        var canvasContextMenu = [
          {
            title: 'Reset Zoom/Pan',
            action: function (elm, d, i) {
              adjustZoom();
            }
          },
          {
            title: 'Reset Selection',
            action: function (elm, d, i) {
              resetSelection();
            }
          }

          // Removed this menu item for the 2/25/2015 demo.
          // {
          //   title: function(d) {
          //     // TODO(duftler): Remove this when the example is no longer needed.
          //     return "Test External Selection";
          //   },
          //   action: function() {
          //     scope.selectionIdList = ["Service:guestbook", "Pod:guestbook-controller-ls6k1"];
          //     scope.$apply();
          //   }
          // }
        ];

        var nodeContextMenu = [
          {
            title: function(d) {
              return "Inspect Node";
            },
            action: function(elm, d, i) {
              inspectNode(d);
            }
          }
        ];

        function togglePinned(d) {
          if (!nodeSettingsCache[d.id]) {
            nodeSettingsCache[d.id] = {};
          }

          if (d.fixed & 8) {
            d.fixed &= ~8;
            force.start().alpha(0.02);

            nodeSettingsCache[d.id].fixed = false;
          } else {
            d.fixed |= 8;

            nodeSettingsCache[d.id].fixed = true;
            tick();
          }
        }

        function inspectNode(d, tagName) {
          if (tagName) {
            // Clone the node.
            d = JSON.parse(JSON.stringify(d));

            if (d.metadata && d.metadata[tagName]) {
              // Prefix the tag name with asterisks so it stands out in the details view.
              d.metadata["** " + tagName] = d.metadata[tagName];

              // Remove the non-decorated tag.
              delete d.metadata[tagName];
            }
          }

          // Add the node details into the service, to be consumed by the
          // next controller.
          inspectNodeService.setDetailData(d);

          // Redirect to the detail view page.
          $location.path('/graph/inspect');
          scope.$apply();
        }

        function wheelScrollHandler() {
          var origTranslate = zoom.translate();

          zoom.translate([origTranslate[0] - window.event.deltaX, origTranslate[1] - window.event.deltaY]);
          zoomed();
        }

        function zoomed() {
          var translate = zoom.translate();
          var scale = zoom.scale();

          g.attr("transform", "translate(" + translate + ")scale(" + scale + ")");

          viewSettingsCache.translate = translate;
          viewSettingsCache.scale = scale;
        }

        function dragstarted(d) {
          d3.event.sourceEvent.stopPropagation();

          // Interrupt any pending transition on this node.
          d3.selectAll('.popup-tags-table').transition();

          d.fixed |= 2;
          d.dragging = true;
        }

        function dragmove(d) {
          d.dragMoved = true;
          d.px = d3.event.x, d.py = d3.event.y;
          force.start().alpha(0.02);
        }

        function dragended(d) {
          d.fixed &= ~6;
          d.dragging = false;
          d.dragMoved = false;
        }

        function d3_layout_forceMouseover(d) {
          showPin |= 2;

          if (showPin == 6) {
            svg.attr("class", "graph pin-cursor");
          }

          d.fixed |= 4;
          d.px = d.x, d.py = d.y;

          d.origOpacity = d3.select(this).style("opacity");
          d.opacity = 0.7;
          tick();
        }

        function d3_layout_forceMouseout(d) {
          showPin &= ~2;
          svg.attr("class", "graph");

          d.fixed &= ~4;

          if (d.origOpacity) {
            d.opacity = d.origOpacity;
            delete d.origOpacity;
          }

          tick();
        }

        function adjustZoom(factor) {
          var scale = zoom.scale(),
              extent = zoom.scaleExtent(),
              translate = zoom.translate(),
              x = translate[0], y = translate[1],
              target_scale = scale * factor;

          var reset = !factor;

          if (reset) {
            target_scale = 1;
            factor = target_scale / scale;
          }

          // If we're already at an extent, done
          if (target_scale === extent[0] || target_scale === extent[1]) { return false; }
          // If the factor is too much, scale it down to reach the extent exactly
          var clamped_target_scale = Math.max(extent[0], Math.min(extent[1], target_scale));
          if (clamped_target_scale != target_scale){
            target_scale = clamped_target_scale;
            factor = target_scale / scale;
          }

          // Center each vector, stretch, then put back
          x = (x - center[0]) * factor + center[0];
          y = (y - center[1]) * factor + center[1];

          if (reset) {
            x = 0;
            y = 0;
          }

          // Transition to the new view over 350ms
          d3.transition().duration(350).tween("zoom", function () {
            var interpolate_scale = d3.interpolate(scale, target_scale),
                interpolate_trans = d3.interpolate(translate, [x,y]);
            return function (t) {
              zoom.scale(interpolate_scale(t))
                  .translate(interpolate_trans(t));
              zoomed();
            };
          });
        }

        function getContainerDimensions() {
          var parentNode = d3.select(element[0].parentNode);
          var width = parseInt(parentNode.style("width"));
          var height = parseInt(parentNode.style("height"));

          return [width, height];
        }

        function resize() {
          var containerDimensions = getContainerDimensions();
          var width = containerDimensions[0] - 16;
          var height = containerDimensions[1] - 19;
          var svg = d3.select(element[0]).select("svg");

          svg.attr('width', width);
          svg.attr('height', height);

          force.size([width, height]).resume();
        }

        function getRandomStartingPosition(radius) {
          var t = 2 * Math.PI * Math.random();
          var u = Math.random() + Math.random();
          var r = u > 1 ? 2 - u : u;

          return [r * Math.cos(t) * radius, r * Math.sin(t) * radius];
        }
      };
    }
  };
}]);
